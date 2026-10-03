import { closeSync, openSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Tokenizer, TokenType } from "@streamparser/json";
import { EventType, Status } from "@prisma/client";

import {
  applicationFieldsSchema, backupEnvelopeSchema, BackupHistoryValidator,
  contactSnapshotSchema, eventSnapshotSchema, rawEventSnapshotSchema, interviewSnapshotSchema, validateBackupEventTime,
} from "@/lib/backup-snapshot";
import { settingsSchema, type ParsedBackupSettings } from "@/lib/backup-settings-schema";

type Kind = "envelope" | "applications" | "application" | "settings" | "events" | "interviews" | "contacts" | "event" | "interview" | "contact";
type Frame = {
  kind: Kind;
  array: boolean;
  state: "key" | "colon" | "value" | "comma";
  empty: boolean;
  key: string;
  seen: Set<string>;
  value: Record<string, unknown>;
  index: number;
};
const childSchemas = { events: eventSnapshotSchema, interviews: interviewSnapshotSchema, contacts: contactSnapshotSchema };
const objectSchemas = {
  envelope: backupEnvelopeSchema.shape, application: applicationFieldsSchema.shape, settings: settingsSchema.shape,
  event: rawEventSnapshotSchema.shape,
  interview: interviewSnapshotSchema.shape, contact: contactSnapshotSchema.shape,
};
const collections = new Set(["events", "interviews", "contacts"]);
const fail = (message: string): never => { throw new Error(message); };

/** Validation only: never opens the live database or emits partially validated records. */
export async function validateBackupStream(chunks: AsyncIterable<Uint8Array>, options: { directory?: string; progress?: () => void } = {}) {
  const directory = options.directory ?? mkdtempSync(join(tmpdir(), "nook-backup-validation-"));
  let database: DatabaseSync | undefined;
  try {
    const path = join(directory, "validation.sqlite");
    closeSync(openSync(path, "wx", 0o600));
    database = new DatabaseSync(path);
    database.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA cache_size = -2048;
      PRAGMA temp_store = FILE;
      CREATE TABLE ids (kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (kind, id)) WITHOUT ROWID;
      CREATE TABLE history (application INTEGER NOT NULL, time INTEGER NOT NULL, position INTEGER NOT NULL,
        from_status TEXT, to_status TEXT, PRIMARY KEY (application, time, position)) WITHOUT ROWID;
    `);
    if (options.directory) database.exec(`
      CREATE TABLE applications (position INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE children (kind TEXT NOT NULL, owner INTEGER NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (kind, owner, position)) WITHOUT ROWID;
      CREATE INDEX children_by_id ON children(kind, owner, json_extract(payload, '$.id'));
    `);
    const stageApplication = options.directory ? database.prepare("INSERT INTO applications VALUES (?, ?)") : undefined;
    const stageChild = options.directory ? database.prepare("INSERT INTO children VALUES (?, ?, ?, ?)") : undefined;
    database.exec("BEGIN");
    const findId = database.prepare("SELECT 1 FROM ids WHERE kind = ? AND id = ?");
    const insertId = database.prepare("INSERT INTO ids VALUES (?, ?)");
    const insertHistory = database.prepare("INSERT INTO history VALUES (?, ?, ?, ?, ?)");
    const readHistory = database.prepare("SELECT time, position, from_status, to_status FROM history WHERE application = ? ORDER BY time, position");
    const frames: Frame[] = [];
    let complete = false;
    let applicationCount = 0;
    const counts = { events: 0, interviews: 0, contacts: 0 };
    let settings: ParsedBackupSettings | undefined;
    const now = Date.now();
    const unique = (kind: string, id: string) => {
      // Check explicitly so storage failures are not misreported as duplicate IDs.
      if (findId.get(kind, id)) fail("Backup contains duplicate IDs");
      insertId.run(kind, id);
    };
    const keysFor = (kind: Kind) => {
      const keys = Object.keys(objectSchemas[kind as keyof typeof objectSchemas] ?? {});
      if (kind === "envelope") keys.push("applications");
      if (kind === "application") keys.push("events", "interviews", "contacts");
      return keys;
    };
    const close = (frame: Frame) => {
      if (!frame.array) {
        for (const key of keysFor(frame.kind)) if (!frame.seen.has(key)) fail(`Missing ${frame.kind} field: ${key}`);
      }
      if (frame.kind === "settings") settings = settingsSchema.parse(frame.value);
      else if (["event", "interview", "contact"].includes(frame.kind)) {
        const parent = frames.at(-1)!;
        const kind = parent.kind as keyof typeof childSchemas;
        const child = childSchemas[kind].parse(frame.value);
        unique(kind, child.id);
        counts[kind]++;
        stageChild?.run(kind, applicationCount, parent.index, JSON.stringify(child));
        if (kind === "events") {
          const event = eventSnapshotSchema.parse(frame.value);
          validateBackupEventTime(event, now, (_, message) => fail(message), parent.index);
          if (event.type === EventType.STATUS_CHANGE) insertHistory.run(applicationCount, event.createdAt.getTime(), parent.index, event.fromStatus, event.toStatus);
        }
      } else if (frame.kind === "application") {
        const fields = applicationFieldsSchema.parse(frame.value);
        unique("applications", fields.id);
        const history = new BackupHistoryValidator((_, message) => fail(message));
        for (const row of readHistory.iterate(applicationCount)) {
          options.progress?.();
          history.add({
            id: "validated", type: EventType.STATUS_CHANGE, detail: null,
            createdAt: new Date(row.time as number),
            fromStatus: row.from_status as Status | null, toStatus: row.to_status as Status | null,
          }, row.position as number);
        }
        history.finish(fields.status);
        stageApplication?.run(applicationCount, JSON.stringify(fields));
        applicationCount++;
      } else if (frame.kind === "envelope") {
        backupEnvelopeSchema.parse(frame.value);
        complete = true;
      }
      const parent = frames.at(-1);
      if (parent) {
        // Arrays retain a counter only. Completed children are never attached to their owner.
        if (parent.array) parent.index++;
        else if (frame.kind === "settings") parent.value[parent.key] = settings;
        parent.state = "comma";
        parent.empty = false;
      }
    };
    const tokenizer = new Tokenizer();
    tokenizer.onToken = ({ token, value }) => {
      if (complete) fail("Trailing content after backup");
      const frame = frames.at(-1);
      if (token === TokenType.RIGHT_BRACE || token === TokenType.RIGHT_BRACKET) {
        if (!frame || frame.array !== (token === TokenType.RIGHT_BRACKET)
          || !(frame.state === "comma" || (frame.empty && frame.state === (frame.array ? "value" : "key")))) fail("Unexpected end of JSON container");
        frames.pop();
        close(frame!);
        return;
      }
      if (token === TokenType.COMMA) {
        if (!frame || frame.state !== "comma") fail("Unexpected comma");
        frame!.state = frame!.array ? "value" : "key";
        return;
      }
      if (token === TokenType.COLON) {
        if (!frame || frame.state !== "colon") fail("Unexpected colon");
        frame!.state = "value";
        return;
      }
      if (frame && !frame.array && frame.state === "key") {
        if (token !== TokenType.STRING || typeof value !== "string") fail("Expected object key");
        const key = value as string;
        if (!keysFor(frame.kind).includes(key)) fail(`Unknown ${frame.kind} field: ${key}`);
        if (frame.seen.has(key)) fail(`Duplicate object key: ${key}`);
        frame.seen.add(key);
        frame.key = key;
        frame.state = "colon";
        return;
      }
      if (frame && frame.state !== "value") fail("Expected JSON delimiter");
      if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) {
        let kind: Kind;
        if (!frame) kind = "envelope";
        else if (frame.kind === "envelope" && frame.key === "applications") kind = "applications";
        else if (frame.kind === "envelope" && frame.key === "settings") kind = "settings";
        else if (frame.kind === "applications") kind = "application";
        else if (frame.kind === "application" && collections.has(frame.key)) kind = frame.key as Kind;
        else if (frame.kind === "events") kind = "event";
        else if (frame.kind === "interviews") kind = "interview";
        else if (frame.kind === "contacts") kind = "contact";
        else return fail("Nested containers are not valid backup fields");
        const array = kind === "applications" || collections.has(kind);
        if (array !== (token === TokenType.LEFT_BRACKET) || frames.length >= 5) fail("Invalid backup container or nesting");
        frames.push({ kind, array, state: array ? "value" : "key", empty: true, key: "", seen: new Set(), value: {}, index: 0 });
        return;
      }
      if (!frame || frame.array) fail("Expected backup object");
      const owner = frame!;
      if ((owner.kind === "envelope" && ["settings", "applications"].includes(owner.key))
        || (owner.kind === "application" && collections.has(owner.key))) fail("Expected backup container");
      owner.value[owner.key] = value;
      owner.state = "comma";
      owner.empty = false;
    };
    const scalars = new BackupScalarReader(tokenizer, () => {
      const frame = frames.at(-1);
      return frame?.state === "value" && ["createdAt", "lastUpdated"].includes(frame.key)
        && ["application", "event", "interview", "contact"].includes(frame.kind);
    });
    for await (const chunk of chunks) {
      // Fixed slices bound decoding work even when a caller supplies a huge chunk.
      for (let offset = 0; offset < chunk.length; offset += 1024) {
        scalars.write(chunk.subarray(offset, offset + 1024));
        options.progress?.();
      }
    }
    scalars.end();
    if (!complete || frames.length || !settings) fail("Truncated or incomplete backup");
    database.exec("COMMIT");
    return { applications: applicationCount, ...counts, settings: settings! };
  } finally {
    try { database?.close(); } finally { if (!options.directory) rmSync(directory, { recursive: true, force: true }); }
  }
}

// The schema has unbounded timestamp precision and accepts numbers by their IEEE-754 value.
// Normalize those spellings incrementally; only ordinary decoded strings have a length guard.
class BackupScalarReader {
  private tokenizer: Tokenizer;
  private isTimestamp: () => boolean;
  private decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  private string: string | null = null;
  private escape = false;
  private stringPoints = 0;
  private lastHighSurrogate = false;
  private unicode: string | null = null;
  private timestamp = false;
  private fraction = false;
  private fractionDigits = 0;
  private number: BackupNumberReader | null = null;

  constructor(tokenizer: Tokenizer, isTimestamp: () => boolean) {
    this.tokenizer = tokenizer;
    this.isTimestamp = isTimestamp;
  }

  private append(character: string) {
    if (this.timestamp && this.fraction && /^[0-9]$/.test(character)) {
      // Date parsing retains the first three fractional digits, without rounding.
      if (this.fractionDigits === 3) return;
      this.fractionDigits++;
    } else {
      this.fraction = this.timestamp && character === "."
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(this.string!);
    }
    // Match Zod's Unicode code-point length, including escaped surrogate pairs.
    for (let index = 0; index < character.length; index++) {
      const unit = character.charCodeAt(index);
      if (!(this.lastHighSurrogate && unit >= 0xdc00 && unit <= 0xdfff)) this.stringPoints++;
      this.lastHighSurrogate = unit >= 0xd800 && unit <= 0xdbff;
    }
    if (this.stringPoints > 5_000) fail("Backup string token exceeds field limits");
    this.string += character;
  }

  write(bytes: Uint8Array) {
    let raw = "";
    const flush = () => { if (raw) this.tokenizer.write(raw); raw = ""; };
    for (const character of this.decoder.decode(bytes, { stream: true })) {
      if (this.string !== null) {
        if (this.unicode !== null) {
          if (!/^[0-9a-fA-F]$/.test(character)) fail("Invalid JSON Unicode escape");
          this.unicode += character;
          if (this.unicode.length === 4) { this.append(String.fromCharCode(parseInt(this.unicode, 16))); this.unicode = null; }
        } else if (this.escape) {
          this.escape = false;
          if (character === "u") this.unicode = "";
          else {
            const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
            if (!Object.hasOwn(escapes, character)) fail("Invalid JSON escape");
            this.append(escapes[character]);
          }
        } else if (character === "\\") this.escape = true;
        else if (character === '"') { this.tokenizer.write(JSON.stringify(this.string)); this.string = null; }
        else {
          if (character.charCodeAt(0) < 32) fail("Unescaped JSON control character");
          this.append(character);
        }
        continue;
      }
      if (this.number && /^[0-9eE+.-]$/.test(character)) { this.number.add(character); continue; }
      if (this.number) { this.tokenizer.write(this.number.finish()); this.number = null; }
      if (character === '"') {
        flush();
        this.string = "";
        this.stringPoints = 0;
        this.lastHighSurrogate = false;
        this.timestamp = this.isTimestamp();
        this.fraction = false;
        this.fractionDigits = 0;
      } else if (/^[0-9-]$/.test(character)) {
        flush();
        this.number = new BackupNumberReader();
        this.number.add(character);
      } else {
        if (character === "\uFEFF") fail("Unexpected JSON byte-order mark");
        raw += character;
      }
    }
    flush();
  }

  end() {
    this.decoder.decode();
    if (this.string !== null) fail("Truncated JSON string");
    if (this.number) this.tokenizer.write(this.number.finish());
    if (!this.tokenizer.isEnded) this.tokenizer.end();
  }
}

class BackupNumberReader {
  private state: "start" | "sign" | "zero" | "integer" | "point" | "fraction" | "exponent" | "exponent-sign" | "exponent-digits" = "start";
  private negative = false;
  private integerDigits = 0;
  private leadingZeros = 0;
  private significant = "";
  private sticky = false;
  private exponent = 0;
  private exponentNegative = false;

  add(character: string) {
    const digit = /^[0-9]$/.test(character);
    if (this.state === "start" && character === "-") { this.negative = true; this.state = "sign"; return; }
    if (this.state === "start" || this.state === "sign") {
      if (!digit) fail("Invalid JSON number");
      this.state = character === "0" ? "zero" : "integer";
    } else if (["zero", "integer", "fraction"].includes(this.state) && /^[eE]$/.test(character)) {
      this.state = "exponent";
      return;
    } else if (["zero", "integer"].includes(this.state) && character === ".") { this.state = "point"; return; }
    else if (this.state === "point") {
      if (!digit) fail("Invalid JSON fraction");
      this.state = "fraction";
    } else if (this.state === "exponent" && ["+", "-"].includes(character)) {
      this.exponentNegative = character === "-";
      this.state = "exponent-sign";
      return;
    } else if (["exponent", "exponent-sign", "exponent-digits"].includes(this.state)) {
      if (!digit) fail("Invalid JSON exponent");
      this.state = "exponent-digits";
      // Once this magnitude exceeds the mantissa's decimal position plus 400,
      // further exponent digits cannot change a finite nonzero result.
      const bound = Math.abs(this.integerDigits - this.leadingZeros - 1) + 400;
      this.exponent = Math.min(bound, this.exponent * 10 + Number(character));
      return;
    } else if (this.state === "zero" || !digit) fail("Invalid JSON number");

    if (this.state === "zero" || this.state === "integer") this.integerDigits++;
    if (!this.significant && character === "0") this.leadingZeros++;
    // Binary64 rounding boundaries terminate within 1,075 decimal places.
    // 1,100 significant digits plus a sticky tail preserve rounding without retaining the token.
    else if (this.significant.length < 1_100) this.significant += character;
    else if (character !== "0") this.sticky = true;
  }

  finish() {
    if (!["zero", "integer", "fraction", "exponent-digits"].includes(this.state)) fail("Truncated JSON number");
    if (!this.significant) return this.negative ? "-0" : "0";
    const exponent = this.integerDigits - this.leadingZeros - 1 + (this.exponentNegative ? -this.exponent : this.exponent);
    const value = Number(`${this.negative ? "-" : ""}${this.significant[0]}.${this.significant.slice(1)}${this.sticky ? "1" : ""}e${exponent}`);
    if (!Number.isFinite(value)) fail("Backup number must be finite");
    return Object.is(value, -0) ? "-0" : String(value);
  }
}
