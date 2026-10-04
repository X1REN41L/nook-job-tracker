import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loader = ["--import", "./scripts/unit-loader-register.mjs"];
const node = (args, env = {}) => ({ command: process.execPath, args, env });
const api = (file) => ({ command: "bash", args: ["scripts/run-backup-api-test.sh", ...(file ? [file] : [])], env: {} });
// Dev servers replace page Cache-Control with no-cache; production renders the shipped policy.
const resourceApi = { ...api("scripts/resource-safeguards-api-test.mjs"), env: { BACKUP_API_SERVER: "production" } };
const suites = {
  unit: [
    node([...loader, "--test", ...[
      "unit-loader", "application-list", "local-date-subscription", "backup-snapshot",
      "status-history", "analytics-period", "calendar-date", "duplicate-match",
      "interviews-grouping", "keyboard-shortcuts", "motion-preference", "settings-store",
    ].map((name) => `scripts/${name}-test.mjs`)]),
    ...["America/New_York", "Asia/Dhaka"].map((TZ) => node([
      ...loader, "--test", "scripts/calendar-date-test.mjs", "scripts/local-date-subscription-test.mjs",
    ], { TZ })),
  ],
  staging: [
    node([...loader, "--test", "scripts/backup-staging-test.mjs"]),
    node(["--experimental-test-module-mocks", ...loader, "--test", "scripts/backup-staging-storage-test.mjs"]),
  ],
  resources: [
    node(["--experimental-transform-types", ...loader, "--test", "scripts/resource-safeguards-test.mjs"]),
    resourceApi,
  ],
  maintenance: [node(["--experimental-test-module-mocks", ...loader, "--test", "scripts/undo-snapshots-test.mjs"])],
  export: [node([...loader, "--test", "scripts/backup-export-test.mjs"])],
  "upload-api": [api("scripts/backup-upload-api-test.mjs")],
  shortcuts: [node([...loader, "--test", "scripts/keyboard-shortcuts-test.mjs"])],
  duplicates: [node([...loader, "scripts/duplicate-match-test.mjs"])],
  "import-scale": [node([...loader, "scripts/import-scale-test.mjs"])],
  setup: [node(["--test", "scripts/setup-test.mjs"])],
  smoke: [api("scripts/smoke-test.mjs")],
  backup: [api()],
  dashboard: [api("scripts/dashboard-api-test.mjs")],
  contention: [api("scripts/contention-api-test.mjs")],
  e2e: [{ command: "bash", args: ["scripts/run-playwright.sh"], env: {} }],
};
suites.keyboard = suites.e2e;
suites.api = ["smoke", "backup", "dashboard", "contention", "upload-api"].flatMap((name) => suites[name]);
suites.api.push(resourceApi);
suites.nonbrowser = [
  "unit", "import-scale", "setup", "staging", "export", "maintenance", "resources",
  "smoke", "backup", "dashboard", "contention", "upload-api",
].flatMap((name) => suites[name]);

const input = process.argv.slice(2);
const dryRun = input[0] === "--dry-run";
if (dryRun) input.shift();
const name = input.shift() ?? "nonbrowser";
if (input[0] === "--") input.shift();
if (!Object.hasOwn(suites, name)) {
  console.error(`Unknown suite: ${name}. Available: ${Object.keys(suites).join(", ")}`);
  process.exit(1);
}

for (const step of suites[name]) {
  const args = [...step.args, ...input];
  if (dryRun) {
    console.log(JSON.stringify({ ...step, args }));
    continue;
  }
  const result = spawnSync(step.command, args, {
    cwd: root,
    env: { ...process.env, ...step.env },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Could not run ${step.command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
