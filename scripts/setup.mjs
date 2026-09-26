import { constants, copyFileSync, accessSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = join(root, ".env.example");
const envPath = join(root, ".env");

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

console.log("Running Prisma db push to create or sync the local database...");

let prismaPath;
try {
  prismaPath = createRequire(import.meta.url).resolve("prisma/build/index.js");
} catch {
  console.error("Setup failed: Prisma is unavailable. Run npm install first.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [prismaPath, "db", "push"], {
  cwd: root,
  stdio: "inherit",
});

if (result.error || result.status !== 0) {
  console.error(`Setup failed: Prisma db push did not complete${result.error ? `: ${result.error.message}` : "."}`);
  process.exit(result.status || 1);
}

console.log("Setup complete. Run npm run dev to start Nook.");
