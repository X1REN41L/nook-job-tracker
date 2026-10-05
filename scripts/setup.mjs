import { constants, accessSync, chmodSync, existsSync, readFileSync, rmSync, writeFileSync, openSync, closeSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = join(root, ".env.example");
const envPath = join(root, ".env");
// Interview dates saved before the schema replaces Application.interviewDate with interview rounds.
// The file stays until the copy succeeds, so running setup again finishes an interrupted upgrade.
const pendingInterviewsPath = join(root, "prisma", "interview-dates-to-copy.json");
// Records the complete rollback copy taken before the legacy conversion. It stays until the converted database is
// verified against that copy, so every retry of an interrupted conversion is checked against the original data.
const rollbackMarkerPath = join(root, "prisma", "setup-rollback.json");

// Checked before anything is written: setup needs node:sqlite and the app needs the Node version in package.json.
const requiredNode = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).engines?.node ?? "";
const minimumNode = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(requiredNode.trim())?.slice(1).map(Number);
if (!minimumNode) {
  console.error(`Setup failed: package.json engines.node must be ">=X.Y.Z", found "${requiredNode}".`);
  process.exit(1);
}
const currentNode = process.versions.node.split(".").map(Number);
const nodeDifference = minimumNode.map((part, index) => currentNode[index] - part).find((difference) => difference !== 0) ?? 0;
if (nodeDifference < 0) {
  console.error(`Setup failed: Node ${requiredNode} is required, but this is Node ${process.versions.node}. Install a newer Node and run setup again.`);
  process.exit(1);
}

try {
  accessSync(examplePath, constants.R_OK);
} catch {
  console.error("Setup failed: .env.example is missing or unreadable.");
  process.exit(1);
}

try {
  const descriptor = openSync(envPath, "wx", 0o600);
  try { writeFileSync(descriptor, readFileSync(examplePath)); } finally { closeSync(descriptor); }
  console.log("Created .env from .env.example.");
} catch (error) {
  if (error.code === "EEXIST") {
    console.log(".env already exists; keeping it unchanged.");
  } else {
    console.error("Setup failed: could not create .env.");
    process.exit(1);
  }
}

function databasePath() {
  const fromEnv = process.env.DATABASE_URL
    ?? /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]*)"?/m.exec(readFileSync(envPath, "utf8"))?.[1];
  if (!fromEnv?.startsWith("file:")) return null;
  // SQLite paths in DATABASE_URL are relative to prisma/schema.prisma.
  return resolve(root, "prisma", fromEnv.slice("file:".length).split("?")[0]);
}

async function openDatabase(path, options = {}) {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(path, options);
}

async function hasLegacyInterviewColumn(path) {
  if (!path || !existsSync(path)) return false;
  const database = await openDatabase(path, { readOnly: true });
  try {
    return database.prepare("PRAGMA table_info(Application)").all().some((column) => column.name === "interviewDate");
  } finally {
    database.close();
  }
}

async function saveLegacyInterviewDates(path) {
  const database = await openDatabase(path, { readOnly: true });
  try {
    // Raw column values keep Prisma's stored date format, so they can be copied without conversion.
    const rows = database.prepare("SELECT id, interviewDate, lastUpdated FROM Application WHERE interviewDate IS NOT NULL").all();
    writeFileSync(pendingInterviewsPath, JSON.stringify(rows), { mode: 0o600 });
    console.log(`Saved ${rows.length} interview ${rows.length === 1 ? "date" : "dates"} to copy into interview rounds.`);
  } finally {
    database.close();
  }
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

// Tables and columns as SQLite stores them, without SQLite's internal tables.
function readSchema(database, schema = "main") {
  const tables = new Map();
  for (const { name } of database.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`).all()) {
    const columns = new Map();
    for (const column of database.prepare(`PRAGMA ${schema}.table_info(${quote(name)})`).all()) {
      columns.set(column.name, {
        type: column.type.toUpperCase(),
        notNull: Boolean(column.notnull),
        hasDefault: column.dflt_value !== null,
        primaryKey: column.pk,
      });
    }
    tables.set(name, columns);
  }
  return tables;
}

const hasRows = (database, schema, table) =>
  Boolean(database.prepare(`SELECT EXISTS (SELECT 1 FROM ${schema}.${quote(table)}) AS found`).get().found);
const hasValues = (database, schema, table, column) =>
  Boolean(database.prepare(`SELECT EXISTS (SELECT 1 FROM ${schema}.${quote(table)} WHERE ${quote(column)} IS NOT NULL) AS found`).get().found);
const isLegacyInterviewColumn = (table, column) => table === "Application" && column === "interviewDate";

// The schema Prisma builds from prisma/schema.prisma, read from a scratch in-memory database.
async function readTargetSchema() {
  const result = spawnSync(process.execPath, [prismaPath, "migrate", "diff", "--from-empty", "--to-schema-datamodel", join("prisma", "schema.prisma"), "--script"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("Prisma could not describe the schema");
  const scratch = await openDatabase(":memory:");
  try {
    scratch.exec(result.stdout);
    return readSchema(scratch);
  } finally {
    scratch.close();
  }
}

// db push with --accept-data-loss would drop or rewrite anything outside the target schema. Only the legacy interview
// column (saved first) and empty tables or columns may be dropped; the rest must be additions Prisma can apply.
function describeDrift(database, target) {
  const problems = [];
  for (const [table, columns] of readSchema(database)) {
    const targetColumns = target.get(table);
    if (!targetColumns) {
      if (hasRows(database, "main", table)) problems.push(`table ${quote(table)} holds data and is not part of Nook's schema`);
      continue;
    }
    const tableHasRows = hasRows(database, "main", table);
    for (const [column, info] of columns) {
      const wanted = targetColumns.get(column);
      if (!wanted) {
        if (!isLegacyInterviewColumn(table, column) && hasValues(database, "main", table, column)) {
          problems.push(`column ${quote(table)}.${quote(column)} holds data and is not part of Nook's schema`);
        }
      } else if (wanted.type !== info.type || wanted.notNull !== info.notNull || wanted.primaryKey !== info.primaryKey) {
        problems.push(`column ${quote(table)}.${quote(column)} has a different definition from Nook's schema`);
      }
    }
    for (const [column, wanted] of targetColumns) {
      if (!columns.has(column) && wanted.notNull && !wanted.hasDefault && tableHasRows) {
        problems.push(`required column ${quote(table)}.${quote(column)} is missing and has no default for existing rows`);
      }
    }
  }
  return problems;
}

function schemaMismatches(actual, target) {
  const problems = [];
  for (const [table, columns] of target) {
    const actualColumns = actual.get(table);
    if (!actualColumns) {
      problems.push(`table ${quote(table)} is missing`);
      continue;
    }
    for (const [column, wanted] of columns) {
      const info = actualColumns.get(column);
      if (!info || info.type !== wanted.type || info.notNull !== wanted.notNull || info.primaryKey !== wanted.primaryKey) {
        problems.push(`column ${quote(table)}.${quote(column)} does not match Nook's schema`);
      }
    }
    for (const column of actualColumns.keys()) {
      if (!columns.has(column)) problems.push(`column ${quote(table)}.${quote(column)} was not removed`);
    }
  }
  for (const table of actual.keys()) {
    if (!target.has(table)) problems.push(`table ${quote(table)} was not removed`);
  }
  return problems;
}

function rollbackRecovery(marker) {
  return `The complete database from before the conversion is saved at ${marker.snapshot}. Setup did not restore it: `
    + `to roll back, stop Nook and replace ${marker.database} with that copy; or fix the cause and run npm run setup again.`;
}

function readRollbackMarker() {
  if (!existsSync(rollbackMarkerPath)) return null;
  const marker = JSON.parse(readFileSync(rollbackMarkerPath, "utf8"));
  if (typeof marker?.database !== "string" || typeof marker?.snapshot !== "string") throw new Error("invalid rollback record");
  return marker;
}

async function checkSnapshot(snapshot, expectedTables) {
  const copy = await openDatabase(snapshot, { readOnly: true });
  try {
    const check = copy.prepare("PRAGMA quick_check").all();
    if (check.length !== 1 || check[0].quick_check !== "ok") throw new Error("rollback copy failed its integrity check");
    const tables = [...readSchema(copy).keys()].sort();
    if (expectedTables && tables.join("\n") !== [...expectedTables].sort().join("\n")) {
      throw new Error("rollback copy is incomplete");
    }
  } finally {
    copy.close();
  }
}

// A uniquely named, owner-only copy made with SQLite's backup API, so it is consistent even if the file is in use.
async function createRollbackSnapshot(path) {
  const { backup } = await import("node:sqlite");
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const snapshot = join(dirname(path), `${basename(path)}.setup-rollback-${stamp}-${randomUUID().slice(0, 8)}.db`);
  closeSync(openSync(snapshot, "wx", 0o600));
  try {
    const source = await openDatabase(path, { readOnly: true });
    let tables;
    try {
      await backup(source, snapshot);
      tables = readSchema(source).keys();
    } finally {
      source.close();
    }
    await checkSnapshot(snapshot, tables);
  } catch (error) {
    rmSync(snapshot, { force: true });
    rmSync(`${snapshot}-journal`, { force: true });
    throw error;
  }
  const marker = { database: path, snapshot };
  writeFileSync(rollbackMarkerPath, JSON.stringify(marker), { mode: 0o600, flag: "wx" });
  return marker;
}

// Every row of the rollback copy must still exist with the same values in each column Nook keeps, and every legacy
// interview date must now be an interview round.
async function verifyConversion(marker, target) {
  await checkSnapshot(marker.snapshot);
  const database = await openDatabase(marker.database, { readOnly: true });
  try {
    const problems = schemaMismatches(readSchema(database), target);
    database.prepare("ATTACH DATABASE ? AS rollback").run(marker.snapshot);
    const current = readSchema(database);
    for (const [table, columns] of readSchema(database, "rollback")) {
      const currentColumns = current.get(table);
      if (!currentColumns) {
        if (hasRows(database, "rollback", table)) problems.push(`rows of table ${quote(table)} were removed`);
        continue;
      }
      const kept = [];
      for (const column of columns.keys()) {
        if (currentColumns.has(column)) kept.push(quote(column));
        else if (!isLegacyInterviewColumn(table, column) && hasValues(database, "rollback", table, column)) {
          problems.push(`values of column ${quote(table)}.${quote(column)} were removed`);
        }
      }
      if (kept.length === 0) continue;
      const missing = database.prepare(`SELECT EXISTS (SELECT ${kept.join(", ")} FROM rollback.${quote(table)} `
        + `EXCEPT SELECT ${kept.join(", ")} FROM main.${quote(table)}) AS found`).get().found;
      if (missing) problems.push(`rows of table ${quote(table)} were removed or changed`);
    }
    if (readSchema(database, "rollback").get("Application")?.has("interviewDate")) {
      const uncopied = database.prepare(`SELECT EXISTS (SELECT 1 FROM rollback.Application AS legacy WHERE legacy.interviewDate IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM main.Interview WHERE applicationId = legacy.id AND date = legacy.interviewDate)) AS found`).get().found;
      if (uncopied) problems.push("legacy interview dates are missing from interview rounds");
    }
    return problems;
  } finally {
    database.close();
  }
}

async function copyLegacyInterviewDates(path) {
  if (!existsSync(pendingInterviewsPath)) return;
  const rows = JSON.parse(readFileSync(pendingInterviewsPath, "utf8"));
  const database = await openDatabase(path);
  let copied = 0;
  try {
    const insert = database.prepare(`INSERT INTO Interview (id, applicationId, date, time, type, interviewers, notes, createdAt)
      SELECT ?, id, ?, NULL, 'OTHER', NULL, NULL, ? FROM Application
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM Interview WHERE applicationId = ? AND date = ?)`);
    database.exec("BEGIN");
    try {
      for (const row of rows) {
        copied += Number(insert.run(randomUUID(), row.interviewDate, row.lastUpdated, row.id, row.id, row.interviewDate).changes);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
  rmSync(pendingInterviewsPath);
  console.log(`Copied ${copied} interview ${copied === 1 ? "date" : "dates"} into interview rounds.`);
}

// SQLite's fixed result description (e.g. "database is locked") carries no SQL, paths, or values.
function sqliteReason(error) {
  return error?.code === "ERR_SQLITE_ERROR" && typeof error.errstr === "string" ? ` (${error.errstr})` : "";
}

const database = databasePath();
// Only Nook's default database is application-owned, so it is kept private, including one Prisma created with 0644
// when Nook started before setup. Configured paths keep their permissions.
if (!process.env.DATABASE_URL && database === join(root, "prisma", "dev.db")) {
  try {
    if (!existsSync(database)) {
      mkdirSync(join(root, "prisma"), { recursive: true, mode: 0o700 });
      closeSync(openSync(database, "wx", 0o600));
    } else if (process.platform !== "win32") {
      chmodSync(database, 0o600);
    }
  } catch (error) {
    if (error.code !== "EEXIST") {
      console.error("Setup failed: could not prepare the private local database.");
      process.exit(1);
    }
  }
}
let prismaPath;
try {
  prismaPath = createRequire(import.meta.url).resolve("prisma/build/index.js");
} catch {
  console.error("Setup failed: Prisma is unavailable. Run npm install first.");
  process.exit(1);
}

let marker;
try {
  marker = readRollbackMarker();
} catch {
  console.error(`Setup failed: the rollback record at ${rollbackMarkerPath} is unreadable. Check the rollback copy beside your database, then remove that record to continue.`);
  process.exit(1);
}
if (marker && marker.database !== database) {
  console.error(`Setup failed: an unfinished conversion of ${marker.database} is recorded in ${rollbackMarkerPath}, but this setup uses a different database. ${rollbackRecovery(marker)}`);
  process.exit(1);
}

let dropsLegacyColumn = false;
try {
  dropsLegacyColumn = await hasLegacyInterviewColumn(database);
} catch (error) {
  console.error(`Setup failed: could not read the existing database${sqliteReason(error)}.${marker ? ` ${rollbackRecovery(marker)}` : ""}`);
  process.exit(1);
}

let target;
if (dropsLegacyColumn || marker) {
  try {
    target = await readTargetSchema();
  } catch {
    console.error(`Setup failed: could not read Nook's database schema.${marker ? ` ${rollbackRecovery(marker)}` : ""}`);
    process.exit(1);
  }
}

if (dropsLegacyColumn) {
  let problems;
  try {
    const inspected = await openDatabase(database, { readOnly: true });
    try { problems = describeDrift(inspected, target); } finally { inspected.close(); }
  } catch (error) {
    console.error(`Setup failed: could not inspect the existing database${sqliteReason(error)}.${marker ? ` ${rollbackRecovery(marker)}` : ""}`);
    process.exit(1);
  }
  if (problems.length > 0) {
    console.error("Setup stopped: converting the legacy interview column would also remove or rewrite data outside it:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(marker ? rollbackRecovery(marker) : "Nothing was changed. Back up the database and resolve these differences before running setup again.");
    process.exit(1);
  }
  try {
    if (marker) {
      await checkSnapshot(marker.snapshot);
      console.log(`Reusing the rollback copy from the unfinished conversion: ${marker.snapshot}`);
    } else {
      marker = await createRollbackSnapshot(database);
      console.log(`Saved a complete rollback copy of the database to ${marker.snapshot}`);
    }
  } catch (error) {
    console.error(marker
      ? `Setup failed: the recorded rollback copy ${marker.snapshot} is missing or unreadable${sqliteReason(error)}. Nothing was changed.`
      : `Setup failed: could not create a complete rollback copy of the database${sqliteReason(error)}. Nothing was changed.`);
    process.exit(1);
  }
  try {
    await saveLegacyInterviewDates(database);
  } catch (error) {
    console.error(`Setup failed: could not read existing interview dates${sqliteReason(error)}. ${rollbackRecovery(marker)}`);
    process.exit(1);
  }
}

console.log("Running Prisma db push to create or sync the local database...");

// Dropping Application.interviewDate needs --accept-data-loss. Its values were saved, the rest of the transition was
// checked above, and the rollback copy is kept until the result is verified. Every other push keeps Prisma's
// data-loss check.
const result = spawnSync(process.execPath, [prismaPath, "db", "push", ...(dropsLegacyColumn ? ["--accept-data-loss"] : [])], {
  cwd: root,
  stdio: "inherit",
});

if (result.error || result.status !== 0) {
  console.error(`Setup failed: Prisma db push did not complete.${marker ? ` ${rollbackRecovery(marker)}` : ""}`);
  process.exit(result.status || 1);
}

try {
  if (database) await copyLegacyInterviewDates(database);
} catch (error) {
  console.error(`Setup failed: could not copy interview dates${sqliteReason(error)}. They are saved in ${pendingInterviewsPath}; run npm run setup again to finish.${marker ? ` ${rollbackRecovery(marker)}` : ""}`);
  process.exit(1);
}

if (marker) {
  let problems;
  try {
    problems = await verifyConversion(marker, target);
  } catch (error) {
    problems = [`the comparison could not run${sqliteReason(error)}`];
  }
  if (problems.length > 0) {
    console.error("Setup failed: the converted database could not be verified against the rollback copy:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(rollbackRecovery(marker));
    process.exit(1);
  }
  rmSync(marker.snapshot);
  rmSync(rollbackMarkerPath);
  console.log("Verified the converted database against the rollback copy, then removed the copy.");
}

console.log("Setup complete. Run npm run dev to start Nook.");
