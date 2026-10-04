import assert from "node:assert/strict";
import { test } from "node:test";
import { InterviewType } from "@prisma/client";
import { backupSnapshotSchema, applicationRestoreSnapshotSchema, canonicalSnapshot } from "../src/lib/backup-snapshot.ts";
import { validateBackupStream } from "../src/lib/backup-stream-validator.ts";
import { defaultSettings } from "../src/lib/settings-defaults.ts";

const date = "2026-09-01T00:00:00.000Z";
const event = (id, fromStatus, toStatus, createdAt = date) => ({
  id, type: "STATUS_CHANGE", fromStatus, toStatus, detail: `${fromStatus ?? "null"} → ${toStatus}`,
  createdAt,
});
const application = () => ({
  id: "app_1", company: "Acme", role: "Engineer", status: "INTERVIEW", archived: false,
  source: null, appliedDate: date, followUpDate: null, followUpNote: null, interviews: [], contacts: [], interviewDatePromptDismissed: false,
  notes: null, jobUrl: null, createdAt: date, lastUpdated: date,
  events: [event("first", null, "APPLIED"), event("second", "APPLIED", "INTERVIEW", "2026-09-02T00:00:00.000Z")],
});
const fixtures = [];
const backup = (record = application()) => {
  const value = { version: 1, applications: [record], settings: defaultSettings };
  fixtures.push(value);
  return value;
};
const accepts = (record) => backupSnapshotSchema.safeParse(backup(record)).success;

test("complete typed history and settings validate without changing v1", () => {
  const result = backupSnapshotSchema.parse(backup());
  assert.equal(result.version, 1);
  assert.equal(result.applications[0].events[0].createdAt.toISOString(), date);
  assert.equal(accepts({ ...application(), status: "OFFER" }), false);
});

for (const id of ["export", "import", "purge", "bulk-delete", "bulk-restore"]) {
  test(`backup rejects reserved application ID ${id}`, () => {
    const result = backupSnapshotSchema.safeParse(backup({ ...application(), id }));
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((issue) =>
      issue.path.join(".") === "applications.0.id" && issue.message === "This ID is reserved"));
  });
}

test("ordinary application IDs and reserved names used as child IDs remain valid", () => {
  const record = application();
  assert.equal(accepts({ ...record, id: "ordinary-app_123", events: [
    { ...record.events[0], id: "bulk-delete" },
    { ...record.events[1], id: "bulk-restore" },
  ] }), true);
});

test("history rejects duplicate initial events, disconnected transitions and mismatched detail", () => {
  assert.equal(accepts({ ...application(), events: [...application().events, event("third", null, "OFFER", "2026-09-03T00:00:00.000Z")] }), false);
  assert.equal(accepts({ ...application(), events: [event("first", null, "APPLIED"), event("second", "OFFER", "INTERVIEW", "2026-09-02T00:00:00.000Z")] }), false);
  assert.equal(accepts({ ...application(), events: [{ ...application().events[0], detail: "wrong" }, application().events[1]] }), false);
  assert.equal(accepts({ ...application(), events: [event("first", null, "APPLIED", "2026-09-03T00:00:00.000Z"), event("second", "APPLIED", "INTERVIEW", date)] }), false);
});

test("legacy untyped history remains importable and equal-time transitions can be ordered", () => {
  const legacy = { ...application(), events: [{ ...application().events[0], fromStatus: null, toStatus: null, detail: "legacy" }] };
  assert.equal(accepts(legacy), true);
  assert.equal(accepts({ ...application(), events: [event("z", null, "APPLIED"), event("a", "APPLIED", "INTERVIEW")] }), true);
});

test("follow-up events name their date, and only a set follow-up carries a note", () => {
  const followUp = (type, detail) => ({ ...application(), events: [...application().events, { id: "follow-up", type, fromStatus: null, toStatus: null, detail, createdAt: "2026-09-03T00:00:00.000Z" }] });
  assert.equal(accepts(followUp("FOLLOW_UP_SET", "2026-09-10")), true);
  assert.equal(accepts(followUp("FOLLOW_UP_SET", "2026-09-10 Email the recruiter")), true);
  assert.equal(accepts(followUp("FOLLOW_UP_DONE", "2026-09-10")), true);
  assert.equal(accepts(followUp("FOLLOW_UP_DONE", "2026-09-10 Email the recruiter")), false, "A done follow-up has no note");
  assert.equal(accepts(followUp("FOLLOW_UP_SET", null)), false);
  assert.equal(accepts(followUp("FOLLOW_UP_SET", "2026-02-30")), false, "The date must exist");
  assert.equal(accepts(followUp("FOLLOW_UP_SET", "2026-09-10  padded")), false, "The note has no surrounding spaces");
  assert.equal(accepts(followUp("FOLLOW_UP_SET", `2026-09-10 ${"x".repeat(201)}`)), false, "The note keeps the follow-up note limit");
  assert.equal(accepts({ ...followUp("FOLLOW_UP_SET", "2026-09-10"), events: [...application().events, { id: "f", type: "FOLLOW_UP_SET", fromStatus: "APPLIED", toStatus: null, detail: "2026-09-10", createdAt: "2026-09-03T00:00:00.000Z" }] }), false, "Follow-ups have no status fields");
});

test("backup rejects future events, invalid stored fields and incomplete settings", () => {
  assert.equal(backupSnapshotSchema.safeParse(backup({ ...application(), events: [event("future", null, "INTERVIEW", "9999-01-01T00:00:00.000Z")] })).success, false);
  for (const change of [
    { appliedDate: "2026-09-01T06:00:00.000Z" }, { id: "export" }, { jobUrl: "javascript:alert(1)" },
    { source: " " }, { company: " Acme" },
  ]) assert.equal(accepts({ ...application(), ...change }), false, JSON.stringify(change));
  assert.equal(backupSnapshotSchema.safeParse({ ...backup(), settings: { ...defaultSettings, boards: [] } }).success, false, "Board colors are no longer a backup setting");
  assert.equal(backupSnapshotSchema.safeParse({ ...backup(), settings: { ...defaultSettings, allApplicationsExpanded: true } }).success, false, "The sidebar application list is no longer a backup setting");
  assert.equal(backupSnapshotSchema.safeParse({ ...backup(), settings: { ...defaultSettings, defaultBoard: "APPLIED" } }).success, false, "The default board is no longer a backup setting");
});

test("restore accepts stored historical fields and canonical comparison ignores event order", () => {
  const stored = { ...application(), revision: 2, events: [...application().events].reverse() };
  assert.equal(applicationRestoreSnapshotSchema.safeParse(stored).success, true);
  assert.equal(canonicalSnapshot(stored), canonicalSnapshot({ ...stored, events: [...stored.events].reverse(), revision: 3 }));
});

async function* chunks(text, size = 97) {
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}

test("streamed validation agrees on existing history and field regressions", async () => {
  const cases = [...fixtures, ...[
    { version: 2 }, { settings: { ...defaultSettings, boards: [] } },
    { settings: { ...defaultSettings, startupPage: undefined } },
    { extra: true }, { applications: [application(), application()] },
    { applications: [{ ...application(), contacts: [{ id: "c", applicationId: "wrong", name: "Name", role: null, email: null, linkedinUrl: null, notes: null, createdAt: date }] }] },
  ].map((change) => ({ ...backup(), ...change }))];
  for (const fixture of cases) {
    const expected = backupSnapshotSchema.safeParse(fixture).success;
    for (const indent of [undefined, 2]) {
      let accepted = true;
      try { await validateBackupStream(chunks(JSON.stringify(fixture, null, indent))); } catch { accepted = false; }
      assert.equal(accepted, expected, JSON.stringify(fixture));
    }
  }
});

test("stream accepts reordered fields, escaped strings, split UTF-8 and former count overflow", async () => {
  const record = { ...application(), company: "日本語 😀", notes: "x".repeat(5_000), events: [] };
  const value = { settings: defaultSettings, applications: [{ contacts: [], ...record }], version: 1 };
  assert.equal((await validateBackupStream(chunks(JSON.stringify(value), 1))).applications, 1);
  const escaped = JSON.stringify(value).replace("x".repeat(5_000), "\\u0078".repeat(5_000));
  assert.equal((await validateBackupStream(chunks(escaped))).applications, 1);
  const many = { version: 1, applications: Array.from({ length: 5_001 }, (_, index) => ({ ...record, id: `app_${index}`, notes: null })), settings: defaultSettings };
  assert.equal(backupSnapshotSchema.safeParse(many).success, true);
  assert.equal((await validateBackupStream(chunks(JSON.stringify(many), 4096))).applications, 5_001);
});

test("stream rejects duplicate keys, malformed syntax, invalid bytes and oversized tokens", async () => {
  const valid = JSON.stringify(backup());
  for (const invalid of [
    valid.slice(0, -1), valid + "{}", valid + "true", valid.replace('"version":1', '"version":1,"version":1'),
    valid.replace('"company":"Acme"', '"company":"Acme","company":"Acme"'),
    valid.replace('"applications":[', '"applications":[null,'),
    valid.replace('"applications":[', '"applications":[['),
    valid.replace('"notes":null', '"notes":{}'), valid.replace('"version":1', '"version":1,'),
    valid.replace('"company":"Acme"', '"company":"' + "x".repeat(40_000) + '"'),
    valid.replace('"version":1', '"version":' + "1".repeat(1000)),
    valid.replace('"version":1', '"version":1e999'),
    valid.replace('"contacts":[]', '"contacts":[{},]'),
  ]) await assert.rejects(validateBackupStream(chunks(invalid)), undefined, invalid.slice(0, 100));
  async function* badBytes() { yield Buffer.concat([Buffer.from(valid.slice(0, -1)), Buffer.from([0xc0, 0xaf]), Buffer.from("}")]); }
  await assert.rejects(validateBackupStream(badBytes()));
  async function* cancelled() { yield Buffer.from(valid.slice(0, 20)); throw new Error("cancelled source"); }
  await assert.rejects(validateBackupStream(cancelled()), /cancelled source/);
});

test("stream validates a dense application beyond 10 MiB without retaining children", async () => {
  let bytes = 0;
  async function* dense() {
    const { contacts, ...record } = { ...application(), events: [] };
    void contacts;
    yield Buffer.from('{"version":1,"applications":[' + JSON.stringify(record).slice(0, -1) + ',"contacts":[');
    for (let index = 0; index < 80_000; index++) {
      const child = JSON.stringify({ id: `contact_${index}`, name: "Name", role: null, email: null, linkedinUrl: null, notes: null, createdAt: date });
      bytes += child.length;
      yield Buffer.from((index ? "," : "") + child);
    }
    yield Buffer.from(']}],"settings":' + JSON.stringify(defaultSettings) + '}');
  }
  const result = await validateBackupStream(dense());
  assert.equal(result.contacts, 80_000);
  assert.ok(bytes > 10 * 1024 * 1024);
});

test("cross-application child ID collisions fail, while IDs in different tables may match", async () => {
  const first = application();
  const second = { ...application(), id: "app_2" };
  const duplicate = { version: 1, applications: [first, second], settings: defaultSettings };
  assert.equal(backupSnapshotSchema.safeParse(duplicate).success, false);
  await assert.rejects(validateBackupStream(chunks(JSON.stringify(duplicate))), /duplicate IDs/);
  const contact = { id: "first", name: "Name", role: null, email: null, linkedinUrl: null, notes: null, createdAt: date };
  const valid = { ...backup(), applications: [{ ...first, contacts: [contact] }] };
  assert.equal(backupSnapshotSchema.safeParse(valid).success, true);
  assert.equal((await validateBackupStream(chunks(JSON.stringify(valid)))).contacts, 1);
});

test("dense equal-time status histories use transition counters", async () => {
  async function* denseHistory() {
    const { events, ...record } = application();
    void events;
    yield Buffer.from('{"version":1,"applications":[' + JSON.stringify(record).slice(0, -1) + ',"events":[');
    yield Buffer.from(JSON.stringify(event("initial", null, "INTERVIEW")));
    for (let index = 0; index < 50_000; index++) {
      const from = index % 2 ? "APPLIED" : "INTERVIEW";
      const to = index % 2 ? "INTERVIEW" : "APPLIED";
      yield Buffer.from("," + JSON.stringify(event(`event_${index}`, from, to)));
    }
    yield Buffer.from(']}],"settings":' + JSON.stringify(defaultSettings) + '}');
  }
  assert.equal((await validateBackupStream(denseHistory())).events, 50_001);
});

async function assertScalarAgreement(text, size = 97) {
  let expected = false;
  try { expected = backupSnapshotSchema.safeParse(JSON.parse(text)).success; } catch { /* Invalid JSON is rejected by both paths. */ }
  let accepted = true;
  let reason = "";
  try { await validateBackupStream(chunks(text, size)); } catch (error) { accepted = false; reason = error.message; }
  assert.equal(accepted, expected, `Scalar disagreement: ${text.slice(0, 90)} (${text.length} characters): ${reason}`);
}

test("scalar number spellings preserve JSON.parse rounding without a token-length quota", async () => {
  const base = JSON.stringify({ version: 1, applications: [], settings: defaultSettings });
  const zeros = "0".repeat(50_000);
  const midpoint = "1.00000000000000011102230246251565404236316680908203125";
  for (const number of [
    "1." + zeros, "1e+" + zeros, "1" + zeros + "e-50000", "0." + zeros + "1e50001",
    midpoint + zeros, midpoint + zeros + "1", "0.999999999999999944488848768742172978818416595458984375" + zeros,
    "1e" + "9".repeat(50_000), "1e-" + "9".repeat(50_000), "-0e" + "9".repeat(50_000),
    "1." + "2".repeat(50_000), "1" + zeros, "-1", "01", "+1", "1.", "1e", "1e+", "1-1", "1e1.0",
  ]) await assertScalarAgreement(base.replace('"version":1', '"version":' + number));
  for (const number of ["15." + zeros, "15" + zeros + "e-50000", "0." + zeros + "15e50002", "1.5e" + "0".repeat(200) + "1", "15.00000000000000088817841970012523233890533447265625" + zeros + "1"]) {
    await assertScalarAgreement(base.replace('"staleApplicationThreshold":15', '"staleApplicationThreshold":' + number));
  }
  await assertScalarAgreement(base.replace('"version":1', '"version":1.' + "0".repeat(130)), 1);
});

test("scalar timestamps retain existing arbitrary fractional precision and offset rules", async () => {
  const long = "2026-09-01T00:00:00.123" + "9".repeat(50_000) + "Z";
  const record = { ...application(), createdAt: long, lastUpdated: long,
    events: [{ ...application().events[0], createdAt: long }, { ...application().events[1], createdAt: long }],
    contacts: [{ id: "contact", name: "Name", role: null, email: null, linkedinUrl: null, notes: null, createdAt: long }],
    interviews: [{ id: "interview", date, time: null, type: Object.values(InterviewType)[0], interviewers: null, notes: null, createdAt: long }],
  };
  const valid = { version: 1, applications: [record], settings: defaultSettings };
  assert.equal(backupSnapshotSchema.safeParse(valid).success, true);
  assert.equal((await validateBackupStream(chunks(JSON.stringify(valid)))).applications, 1);
  for (const timestamp of [
    long, long.slice(0, -1) + "+06:00", long.replace(".123", "."),
    long.replace("2026-09-01", "2026-02-30"), long.slice(0, -1),
    "2026-09-01T00:00:00.Z", "2026-09-01T00:00:00.123" + "0".repeat(50_000) + "xZ",
  ]) await assertScalarAgreement(JSON.stringify({ ...backup(), applications: [{ ...application(), createdAt: timestamp }] }));
  const escaped = JSON.stringify({ ...backup(), applications: [{ ...application(), createdAt: long }] }).replace(long, long.replace(/9/g, "\\u0039"));
  await assertScalarAgreement(escaped);
});

test("scalar decoding rejects oversized decoded fields and invalid escapes before retaining tokens", async () => {
  const valid = JSON.stringify(backup());
  for (const scalar of ['"' + "\\u0078".repeat(5_001) + '"', '"\\q"', '"\\u12xz"', '"unescaped\nnewline"', '"unfinished\\']) {
    await assertScalarAgreement(valid.replace('"notes":null', '"notes":' + scalar));
  }
  await assertScalarAgreement(valid.replace('"notes":null', '"notes":"' + "😀".repeat(5_000) + '"'), 1);
  await assertScalarAgreement(valid.replace('"notes":null', '"notes":"' + "😀".repeat(5_001) + '"'));
  await assertScalarAgreement(valid.replace('"notes":null', '"notes":"' + "\\ud83d\\ude00".repeat(5_000) + '"'));
  await assertScalarAgreement(valid.replace('"notes":null', '"notes":"' + "\\ud83d".repeat(5_000) + '"'));
  await assertScalarAgreement("\uFEFF" + valid);
});
