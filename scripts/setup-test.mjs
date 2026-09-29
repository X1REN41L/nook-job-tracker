import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sourceScript = resolve(dirname(fileURLToPath(import.meta.url)), "setup.mjs");
const projectRoot = resolve(dirname(sourceScript), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "nook-setup-test-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "node_modules", "prisma", "build"), { recursive: true });
  copyFileSync(sourceScript, join(root, "scripts", "setup.mjs"));
  writeFileSync(join(root, "node_modules", "prisma", "build", "index.js"), `
    const fs = require("node:fs");
    const path = require("node:path");
    fs.appendFileSync(path.join(process.cwd(), "prisma-calls"), process.argv.slice(2).join(" ") + "\\n");
    process.exit(Number(process.env.FAKE_PRISMA_EXIT || 0));
  `);
  return root;
}

function runSetup(root, env = {}) {
  return spawnSync(process.execPath, [join(root, "scripts", "setup.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
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

    writeFileSync(join(root, ".env"), 'DATABASE_URL="file:./custom.db"\n');
    const second = runSetup(root);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /\.env already exists; keeping it unchanged/);
    assert.equal(readFileSync(join(root, ".env"), "utf8"), 'DATABASE_URL="file:./custom.db"\n');
    assert.equal(readFileSync(join(root, "prisma-calls"), "utf8"), "db push\ndb push\n");
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

test("npm setup creates a SQLite database and preserves records on a second run", async () => {
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
    symlinkSync(join(projectRoot, "node_modules"), join(root, "node_modules"), "junction");

    const first = spawnSync(npmCommand, ["run", "setup"], {
      cwd: root,
      encoding: "utf8",
      env: isolatedEnv,
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(first.stdout, /Created \.env from \.env\.example/);

    const { PrismaClient } = await import("@prisma/client");
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
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    // The temporary project shares node_modules, so its `prisma db push` regenerated the shared Prisma
    // client against the temporary (now deleted) schema folder. Regenerate it from this project, or the
    // app would resolve `file:./dev.db` to an empty database inside node_modules.
    const regenerated = spawnSync(npmCommand, ["exec", "--", "prisma", "generate"], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(regenerated.status, 0, regenerated.stderr || regenerated.stdout);
  }
});
