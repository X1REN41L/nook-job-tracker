import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, statSync, chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const sourceScript = resolve(dirname(fileURLToPath(import.meta.url)), "setup.mjs");
const projectRoot = resolve(dirname(sourceScript), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

// The schema Prisma builds for Nook; the fake Prisma prints it for setup's transition inspection.
const targetSql = (() => {
  const result = spawnSync(process.execPath, [
    createRequire(join(projectRoot, "package.json")).resolve("prisma/build/index.js"),
    "migrate", "diff", "--from-empty", "--to-schema-datamodel", join(projectRoot, "prisma", "schema.prisma"), "--script",
  ], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
})();

function createFixture() {
  // Real path: setup reports paths from its own resolved location (macOS tmpdir is a symlink).
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nook-setup-test-")));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "node_modules", "prisma", "build"), { recursive: true });
  copyFileSync(sourceScript, join(root, "scripts", "setup.mjs"));
  writeFileSync(join(root, "target.sql"), targetSql);
  // FAKE_PRISMA_APPLY performs the legacy conversion ("lossy" also deletes a row); FAKE_PRISMA_INTERRUPT copies
  // Application like Prisma's table redefinition, then dies before finishing.
  writeFileSync(join(root, "node_modules", "prisma", "build", "index.js"), `
    const fs = require("node:fs");
    const path = require("node:path");
    const args = process.argv.slice(2);
    fs.appendFileSync(path.join(process.cwd(), "prisma-calls"), args.join(" ") + "\\n");
    if (args[0] === "migrate") {
      fs.writeSync(1, fs.readFileSync(path.join(process.cwd(), "target.sql"), "utf8"));
      process.exit(0);
    }
    const open = () => new (require("node:sqlite").DatabaseSync)(path.join(process.cwd(), "prisma", "dev.db"));
    if (process.env.FAKE_PRISMA_INTERRUPT) {
      open().exec("CREATE TABLE new_Application AS SELECT * FROM Application");
      process.kill(process.pid, "SIGKILL");
    }
    if (process.env.FAKE_PRISMA_APPLY) {
      const database = open();
      if (process.env.FAKE_PRISMA_APPLY === "lossy") database.exec("DELETE FROM Application WHERE id = 'plain'");
      database.exec("ALTER TABLE Application DROP COLUMN interviewDate");
      database.exec("ALTER TABLE ApplicationEvent DROP COLUMN emailSnippet");
      database.exec("DROP TABLE IF EXISTS Scratch");
      database.close();
    }
    process.exit(Number(process.env.FAKE_PRISMA_EXIT || 0));
  `);
  return root;
}

// A Nook database from before interview rounds: Application.interviewDate plus the unused, later removed
// ApplicationEvent.emailSnippet column.
const legacyRows = [
  { id: "legacy", company: "Legacy company", role: "Legacy role", appliedDate: Date.UTC(2020, 1, 1), interviewDate: Date.UTC(2020, 1, 29), lastUpdated: Date.UTC(2020, 1, 20) },
  { id: "plain", company: "Plain company", role: "Plain role", appliedDate: Date.UTC(2020, 1, 2), interviewDate: null, lastUpdated: Date.UTC(2020, 1, 21) },
];

function createLegacyFixture(changeSchema = "") {
  const root = createFixture();
  mkdirSync(join(root, "prisma"));
  writeFileSync(join(root, ".env.example"), 'DATABASE_URL="file:./dev.db"\n');
  const database = new DatabaseSync(join(root, "prisma", "dev.db"));
  try {
    database.exec(targetSql);
    database.exec("ALTER TABLE Application ADD COLUMN interviewDate DATETIME");
    database.exec("ALTER TABLE ApplicationEvent ADD COLUMN emailSnippet TEXT");
    const insert = database.prepare("INSERT INTO Application (id, company, role, appliedDate, interviewDate, lastUpdated) VALUES (?, ?, ?, ?, ?, ?)");
    for (const row of legacyRows) insert.run(row.id, row.company, row.role, row.appliedDate, row.interviewDate, row.lastUpdated);
    database.prepare("INSERT INTO ApplicationEvent (id, applicationId, type, detail, createdAt) VALUES ('event', 'legacy', 'NOTE_ADDED', 'kept note', ?)").run(Date.UTC(2020, 1, 3));
    database.exec(changeSchema);
  } finally {
    database.close();
  }
  return root;
}

const rollbackCopies = (root) => readdirSync(join(root, "prisma")).filter((name) => name.startsWith("dev.db.setup-rollback-"));
const readRows = (path, sql) => {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return database.prepare(sql).all().map((row) => ({ ...row })); } finally { database.close(); }
};
const migrateCall = "migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script\n";

function runSetup(root, env = {}) {
  const isolatedEnv = { ...process.env };
  delete isolatedEnv.DATABASE_URL;
  return spawnSync(process.execPath, [join(root, "scripts", "setup.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...isolatedEnv, ...env },
  });
}

test("setup creates .env once and runs db push on each invocation", () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, ".env.example"), 'DATABASE_URL="file:./dev.db"\n');

    const first = runSetup(root);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Created \.env from \.env\.example/);
    assert.equal(readFileSync(join(root, ".env"), "utf8"), 'DATABASE_URL="file:./dev.db"\n');

    assert.equal(statSync(join(root, ".env")).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, "prisma", "dev.db")).mode & 0o777, 0o600);
    chmodSync(join(root, ".env"), 0o644);
    chmodSync(join(root, "prisma", "dev.db"), 0o644);
    writeFileSync(join(root, ".env"), 'DATABASE_URL="file:./custom.db"\n');
    const second = runSetup(root);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /\.env already exists; keeping it unchanged/);
    assert.equal(readFileSync(join(root, ".env"), "utf8"), 'DATABASE_URL="file:./custom.db"\n');
    assert.equal(readFileSync(join(root, "prisma-calls"), "utf8"), "db push\ndb push\n");
    assert.equal(statSync(join(root, ".env")).mode & 0o777, 0o644);
    assert.equal(statSync(join(root, "prisma", "dev.db")).mode & 0o777, 0o644);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup fails clearly when .env.example is missing", () => {
  const root = createFixture();
  try {
    const result = runSetup(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.env\.example is missing or unreadable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup reports Prisma failure", () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, ".env.example"), 'DATABASE_URL="file:./dev.db"\n');
    const result = runSetup(root, { FAKE_PRISMA_EXIT: "2" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Prisma db push did not complete/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed legacy schema push keeps a verified rollback copy, and a retry converts and verifies against it", () => {
  const root = createLegacyFixture("CREATE TABLE Scratch (id TEXT)");
  try {
    const databasePath = join(root, "prisma", "dev.db");
    const before = readRows(databasePath, "SELECT * FROM Application ORDER BY id");
    const failed = runSetup(root, { FAKE_PRISMA_EXIT: "2", DATABASE_URL: "file:./dev.db" });
    assert.equal(failed.status, 2, failed.stderr);
    const [copyName, ...others] = rollbackCopies(root);
    assert.equal(others.length, 0);
    const copyPath = join(root, "prisma", copyName);
    assert.equal(statSync(copyPath).mode & 0o777, 0o600);
    assert.deepEqual(readRows(copyPath, "SELECT * FROM Application ORDER BY id"), before);
    assert.deepEqual(readRows(copyPath, "SELECT detail FROM ApplicationEvent"), [{ detail: "kept note" }]);
    const marker = JSON.parse(readFileSync(join(root, "prisma", "setup-rollback.json"), "utf8"));
    assert.deepEqual(marker, { database: databasePath, snapshot: copyPath });
    assert.equal(statSync(join(root, "prisma", "setup-rollback.json")).mode & 0o777, 0o600);
    assert.match(failed.stdout, new RegExp(`Saved a complete rollback copy of the database to .*${copyName}`));
    assert.match(failed.stderr, /Prisma db push did not complete/);
    assert.ok(failed.stderr.includes(`saved at ${copyPath}. Setup did not restore it`), failed.stderr);
    assert.deepEqual(readRows(databasePath, "SELECT * FROM Application ORDER BY id"), before, "the live database must be untouched");
    const pendingPath = join(root, "prisma", "interview-dates-to-copy.json");
    assert.deepEqual(JSON.parse(readFileSync(pendingPath, "utf8")), [{ id: "legacy", interviewDate: legacyRows[0].interviewDate, lastUpdated: legacyRows[0].lastUpdated }]);
    assert.equal(readFileSync(join(root, "prisma-calls"), "utf8"), `${migrateCall}db push --accept-data-loss\n`);

    const retried = runSetup(root, { FAKE_PRISMA_APPLY: "1", DATABASE_URL: "file:./dev.db" });
    assert.equal(retried.status, 0, retried.stderr);
    assert.match(retried.stdout, /Reusing the rollback copy from the unfinished conversion/);
    assert.match(retried.stdout, /Copied 1 interview date/);
    assert.match(retried.stdout, /Verified the converted database against the rollback copy, then removed the copy/);
    assert.deepEqual(rollbackCopies(root), []);
    assert.equal(existsSync(join(root, "prisma", "setup-rollback.json")), false);
    assert.equal(existsSync(pendingPath), false);
    assert.deepEqual(readRows(databasePath, "SELECT * FROM Application ORDER BY id"),
      before.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== "interviewDate"))));
    assert.deepEqual(readRows(databasePath, "SELECT applicationId, date FROM Interview"), [{ applicationId: "legacy", date: legacyRows[0].interviewDate }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy conversion rejects unrelated destructive drift before changing anything", () => {
  const cases = [
    ["CREATE TABLE Notes (id TEXT, body TEXT); INSERT INTO Notes VALUES ('n', 'private');", /table "Notes" holds data and is not part of Nook's schema/],
    ["UPDATE ApplicationEvent SET emailSnippet = 'kept';", /column "ApplicationEvent"\."emailSnippet" holds data/],
    ["ALTER TABLE Application ADD COLUMN extra TEXT; UPDATE Application SET extra = 'x' WHERE id = 'plain';", /column "Application"\."extra" holds data/],
    ["ALTER TABLE Application DROP COLUMN followUpNote; ALTER TABLE Application ADD COLUMN followUpNote INTEGER;", /column "Application"\."followUpNote" has a different definition/],
    ["ALTER TABLE Application DROP COLUMN role;", /required column "Application"\."role" is missing and has no default/],
  ];
  for (const [changeSchema, problem] of cases) {
    const root = createLegacyFixture(changeSchema);
    try {
      const databasePath = join(root, "prisma", "dev.db");
      const before = readFileSync(databasePath);
      const result = runSetup(root, { DATABASE_URL: "file:./dev.db" });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /converting the legacy interview column would also remove or rewrite data outside it/);
      assert.match(result.stderr, problem);
      assert.match(result.stderr, /Nothing was changed/);
      assert.equal(readFileSync(join(root, "prisma-calls"), "utf8"), migrateCall, "db push must not run");
      assert.deepEqual(readFileSync(databasePath), before);
      assert.deepEqual(rollbackCopies(root), []);
      assert.equal(existsSync(join(root, "prisma", "setup-rollback.json")), false);
      assert.equal(existsSync(join(root, "prisma", "interview-dates-to-copy.json")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("an interrupted conversion is never retried past drift, and keeps reporting the original rollback copy", () => {
  const root = createLegacyFixture();
  try {
    const databasePath = join(root, "prisma", "dev.db");
    const interrupted = runSetup(root, { FAKE_PRISMA_INTERRUPT: "1", DATABASE_URL: "file:./dev.db" });
    assert.equal(interrupted.status, 1, interrupted.stderr);
    const [copyName] = rollbackCopies(root);
    const copyPath = join(root, "prisma", copyName);
    assert.ok(interrupted.stderr.includes(`saved at ${copyPath}`), interrupted.stderr);
    const partial = readFileSync(databasePath);

    const retry = runSetup(root, { DATABASE_URL: "file:./dev.db" });
    assert.equal(retry.status, 1, retry.stderr);
    assert.match(retry.stderr, /table "new_Application" holds data and is not part of Nook's schema/);
    assert.ok(retry.stderr.includes(`saved at ${copyPath}. Setup did not restore it`), retry.stderr);
    assert.deepEqual(rollbackCopies(root), [copyName], "a retry must not replace the original rollback copy");
    assert.deepEqual(readFileSync(databasePath), partial, "setup must not overwrite the database with the copy");
    assert.equal(readFileSync(join(root, "prisma-calls"), "utf8"), `${migrateCall}db push --accept-data-loss\n${migrateCall}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a conversion that loses rows fails verification and keeps the rollback copy", () => {
  const root = createLegacyFixture();
  try {
    const databasePath = join(root, "prisma", "dev.db");
    const lossy = runSetup(root, { FAKE_PRISMA_APPLY: "lossy", DATABASE_URL: "file:./dev.db" });
    assert.equal(lossy.status, 1, lossy.stderr);
    assert.match(lossy.stderr, /could not be verified against the rollback copy/);
    assert.match(lossy.stderr, /rows of table "Application" were removed or changed/);
    const [copyName] = rollbackCopies(root);
    assert.ok(lossy.stderr.includes(`saved at ${join(root, "prisma", copyName)}`), lossy.stderr);
    assert.equal(existsSync(join(root, "prisma", "setup-rollback.json")), true);
    assert.deepEqual(readRows(join(root, "prisma", copyName), "SELECT id FROM Application ORDER BY id"), [{ id: "legacy" }, { id: "plain" }]);

    // Without the legacy column, a rerun still verifies against the same copy and never restores it automatically.
    const rerun = runSetup(root, { DATABASE_URL: "file:./dev.db" });
    assert.equal(rerun.status, 1, rerun.stderr);
    assert.match(rerun.stderr, /rows of table "Application" were removed or changed/);
    assert.deepEqual(rollbackCopies(root), [copyName]);
    assert.deepEqual(readRows(databasePath, "SELECT id FROM Application"), [{ id: "legacy" }]);
    assert.match(readFileSync(join(root, "prisma-calls"), "utf8"), /db push\n$/, "the rerun keeps Prisma's own data-loss check");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup stops when the rollback record belongs to another database", () => {
  const root = createLegacyFixture();
  try {
    writeFileSync(join(root, "prisma", "setup-rollback.json"), JSON.stringify({ database: "/elsewhere/other.db", snapshot: "/elsewhere/copy.db" }));
    const result = runSetup(root, { DATABASE_URL: "file:./dev.db" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /unfinished conversion of \/elsewhere\/other\.db/);
    assert.equal(existsSync(join(root, "prisma-calls")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Nook's server scripts bind only to loopback", () => {
  const { scripts } = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
  assert.match(scripts.dev, /^next dev -H 127\.0\.0\.1$/);
  assert.match(scripts.start, /^next start -H 127\.0\.0\.1$/);
});

test("real setup preserves records, upgrades an added interviewDate column, rolls back failed copies, and retries after a lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "nook-setup-prisma-test-"));
  const isolatedEnv = { ...process.env };
  delete isolatedEnv.DATABASE_URL;
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "prisma"));
    copyFileSync(sourceScript, join(root, "scripts", "setup.mjs"));
    copyFileSync(join(projectRoot, "package.json"), join(root, "package.json"));
    copyFileSync(join(projectRoot, ".env.example"), join(root, ".env.example"));
    copyFileSync(join(projectRoot, "prisma", "schema.prisma"), join(root, "prisma", "schema.prisma"));
    // Setup regenerates Prisma, so the fixture needs its own writable dependency tree.
    cpSync(join(projectRoot, "node_modules"), join(root, "node_modules"), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      verbatimSymlinks: true,
    });

    const first = spawnSync(npmCommand, ["run", "setup"], {
      cwd: root,
      encoding: "utf8",
      env: isolatedEnv,
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(first.stdout, /Created \.env from \.env\.example/);

    const { PrismaClient } = createRequire(join(root, "package.json"))("@prisma/client");
    const prisma = new PrismaClient({
      datasources: { db: { url: `file:${join(root, "prisma", "dev.db")}` } },
    });
    try {
      await prisma.application.create({
        data: { company: "Setup test company", role: "Setup test role", appliedDate: new Date() },
      });

      const second = spawnSync(npmCommand, ["run", "setup"], {
        cwd: root,
        encoding: "utf8",
        env: isolatedEnv,
      });
      assert.equal(second.status, 0, second.stderr || second.stdout);
      assert.match(second.stdout, /\.env already exists; keeping it unchanged/);
      assert.equal(await prisma.application.count(), 1);
      const application = await prisma.application.findFirstOrThrow();
      await prisma.$disconnect();

      const databasePath = join(root, "prisma", "dev.db");
      const sidecarPath = join(root, "prisma", "interview-dates-to-copy.json");
      const legacyDate = Date.UTC(2020, 1, 29);
      const legacyUpdated = Date.UTC(2020, 1, 20, 12, 34);
      const database = new DatabaseSync(databasePath);
      database.exec("ALTER TABLE Application ADD COLUMN interviewDate DATETIME");
      database.exec("ALTER TABLE ApplicationEvent ADD COLUMN emailSnippet TEXT");
      database.prepare("UPDATE Application SET interviewDate = ?, lastUpdated = ? WHERE id = ?")
        .run(legacyDate, legacyUpdated, application.id);
      database.close();

      // Prisma cannot push while another connection holds the write lock; the conversion stops with its rollback copy.
      const lockHolder = new DatabaseSync(databasePath);
      let lockedPush;
      try {
        lockHolder.exec("BEGIN IMMEDIATE");
        lockedPush = runSetup(root, isolatedEnv);
      } finally {
        if (lockHolder.isTransaction) lockHolder.exec("ROLLBACK");
        lockHolder.close();
      }
      assert.notEqual(lockedPush.status, 0, lockedPush.stderr || lockedPush.stdout);
      assert.match(lockedPush.stderr, /Prisma db push did not complete\. The complete database from before the conversion is saved at /);
      const [rollbackName] = readdirSync(join(root, "prisma")).filter((name) => name.startsWith("dev.db.setup-rollback-"));
      assert.equal(statSync(join(root, "prisma", rollbackName)).mode & 0o777, 0o600);
      const lockedSchema = new DatabaseSync(databasePath, { readOnly: true });
      assert.equal(lockedSchema.prepare("PRAGMA table_info(Application)").all().some((column) => column.name === "interviewDate"), true);
      lockedSchema.close();

      const upgrade = runSetup(root, isolatedEnv);
      assert.equal(upgrade.status, 0, upgrade.stderr || upgrade.stdout);
      assert.match(upgrade.stdout, /Reusing the rollback copy from the unfinished conversion/);
      assert.match(upgrade.stdout, /Saved 1 interview date/);
      assert.match(upgrade.stdout, /Copied 1 interview date/);
      assert.match(upgrade.stdout, /Verified the converted database against the rollback copy, then removed the copy/);
      assert.equal(existsSync(sidecarPath), false);
      assert.equal(existsSync(join(root, "prisma", rollbackName)), false);
      assert.equal(existsSync(join(root, "prisma", "setup-rollback.json")), false);
      const upgraded = await prisma.application.findUniqueOrThrow({ where: { id: application.id }, include: { interviews: true } });
      assert.equal(upgraded.company, application.company);
      assert.equal(upgraded.role, application.role);
      assert.equal(upgraded.appliedDate.getTime(), application.appliedDate.getTime());
      assert.equal(upgraded.lastUpdated.getTime(), legacyUpdated);
      assert.equal(upgraded.interviews.length, 1);
      assert.equal(upgraded.interviews[0].date.getTime(), legacyDate);
      assert.equal(upgraded.interviews[0].createdAt.getTime(), legacyUpdated);
      assert.equal(upgraded.interviews[0].type, "OTHER");
      assert.equal(upgraded.interviews[0].time, null);
      await prisma.$disconnect();
      const schemaDatabase = new DatabaseSync(databasePath);
      assert.equal(schemaDatabase.prepare("PRAGMA table_info(Application)").all().some((column) => column.name === "interviewDate"), false);
      schemaDatabase.close();

      const nextDate = Date.UTC(2020, 2, 1);
      const pending = [
        { id: application.id, interviewDate: legacyDate, lastUpdated: legacyUpdated },
        { id: application.id, interviewDate: nextDate, lastUpdated: legacyUpdated },
        { id: application.id, interviewDate: null, lastUpdated: legacyUpdated },
      ];
      const pendingText = JSON.stringify(pending);
      writeFileSync(sidecarPath, pendingText);
      const failedCopy = runSetup(root, isolatedEnv);
      assert.equal(failedCopy.status, 1, failedCopy.stderr || failedCopy.stdout);
      assert.match(failedCopy.stderr, /could not copy interview dates/);
      assert.equal(readFileSync(sidecarPath, "utf8"), pendingText);
      assert.equal(await prisma.interview.count(), 1, "partial copy must roll back");
      await prisma.$disconnect();

      writeFileSync(sidecarPath, JSON.stringify(pending.slice(0, 2)));
      const recovered = runSetup(root, isolatedEnv);
      assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
      assert.match(recovered.stdout, /Copied 1 interview date/);
      assert.equal(existsSync(sidecarPath), false);
      assert.deepEqual((await prisma.interview.findMany({ orderBy: { date: "asc" } })).map((interview) => interview.date.getTime()), [legacyDate, nextDate]);
      await prisma.$disconnect();
      const rerun = runSetup(root, isolatedEnv);
      assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
      assert.equal(await prisma.application.count(), 1);
      assert.equal(await prisma.interview.count(), 2, "rerunning recovery must not duplicate interviews");
      await prisma.$disconnect();

      // A transient failure (another connection holds the write lock) leaves the sidecar untouched, and running
      // setup again with that same file finishes the copy.
      const retryDate = Date.UTC(2020, 2, 2);
      const retryText = JSON.stringify([{ id: application.id, interviewDate: retryDate, lastUpdated: legacyUpdated }]);
      writeFileSync(sidecarPath, retryText);
      const writer = new DatabaseSync(databasePath);
      let locked;
      try {
        writer.exec("BEGIN IMMEDIATE");
        locked = runSetup(root, isolatedEnv);
      } finally {
        if (writer.isTransaction) writer.exec("ROLLBACK");
        writer.close();
      }
      assert.equal(locked.status, 1, locked.stderr || locked.stdout);
      assert.match(locked.stderr, /could not copy interview dates \(database is locked\)/);
      assert.equal(readFileSync(sidecarPath, "utf8"), retryText);
      assert.equal(await prisma.interview.count(), 2);
      await prisma.$disconnect();
      const retried = runSetup(root, isolatedEnv);
      assert.equal(retried.status, 0, retried.stderr || retried.stdout);
      assert.match(retried.stdout, /Copied 1 interview date/);
      assert.equal(existsSync(sidecarPath), false);
      assert.deepEqual((await prisma.interview.findMany({ orderBy: { date: "asc" } })).map((interview) => interview.date.getTime()), [legacyDate, nextDate, retryDate]);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
