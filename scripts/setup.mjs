import { constants, copyFileSync, accessSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = join(root, ".env.example");
const envPath = join(root, ".env");
// Interview dates saved before the schema replaces Application.interviewDate with interview rounds.
// The file stays until the copy succeeds, so running setup again finishes an interrupted upgrade.
const pendingInterviewsPath = join(root, "prisma", "interview-dates-to-copy.json");

try {
  accessSync(examplePath, constants.R_OK);
} catch {
  console.error("Setup failed: .env.example is missing or unreadable.");
  process.exit(1);
}

try {
  copyFileSync(examplePath, envPath, constants.COPYFILE_EXCL);
  console.log("Created .env from .env.example.");
} catch (error) {
  if (error.code === "EEXIST") {
    console.log(".env already exists; keeping it unchanged.");
  } else {
    console.error(`Setup failed: could not create .env: ${error.message}`);
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

async function openDatabase(path) {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(path);
}

async function saveLegacyInterviewDates(path) {
  if (!path || !existsSync(path)) return false;
  const database = await openDatabase(path);
  try {
    const columns = database.prepare("PRAGMA table_info(Application)").all().map((column) => column.name);
    if (!columns.includes("interviewDate")) return false;
    // Raw column values keep Prisma's stored date format, so they can be copied without conversion.
    const rows = database.prepare("SELECT id, interviewDate, lastUpdated FROM Application WHERE interviewDate IS NOT NULL").all();
    writeFileSync(pendingInterviewsPath, JSON.stringify(rows));
    console.log(`Saved ${rows.length} interview ${rows.length === 1 ? "date" : "dates"} to copy into interview rounds.`);
    return true;
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

const database = databasePath();
let dropsLegacyColumn = false;
try {
  dropsLegacyColumn = await saveLegacyInterviewDates(database);
} catch (error) {
  console.error(`Setup failed: could not read existing interview dates: ${error.message}`);
  process.exit(1);
}

console.log("Running Prisma db push to create or sync the local database...");

let prismaPath;
try {
  prismaPath = createRequire(import.meta.url).resolve("prisma/build/index.js");
} catch {
  console.error("Setup failed: Prisma is unavailable. Run npm install first.");
  process.exit(1);
}

// Dropping Application.interviewDate needs --accept-data-loss; its values were saved above. Every other push
// keeps Prisma's data-loss check.
const result = spawnSync(process.execPath, [prismaPath, "db", "push", ...(dropsLegacyColumn ? ["--accept-data-loss"] : [])], {
  cwd: root,
  stdio: "inherit",
});

if (result.error || result.status !== 0) {
  console.error(`Setup failed: Prisma db push did not complete${result.error ? `: ${result.error.message}` : "."}`);
  process.exit(result.status || 1);
}

try {
  if (database) await copyLegacyInterviewDates(database);
} catch (error) {
  console.error(`Setup failed: could not copy interview dates (${error.message}). They are saved in ${pendingInterviewsPath}; run npm run setup again to finish.`);
  process.exit(1);
}

console.log("Setup complete. Run npm run dev to start Nook.");
