import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import ts from "typescript";

const duplicateSource = await readFile(new URL("../src/lib/duplicate-match.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(duplicateSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const duplicateUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { findPossibleDuplicate } = await import(duplicateUrl);
const indexSource = (await readFile(new URL("../src/lib/import-duplicate-index.ts", import.meta.url), "utf8"))
  .replace('from "@/lib/duplicate-match"', `from "${duplicateUrl}"`);
const indexCompiled = ts.transpileModule(indexSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { ImportDuplicateIndex } = await import(`data:text/javascript;base64,${Buffer.from(indexCompiled).toString("base64")}`);

const applications = [];
const duplicateIndex = new ImportDuplicateIndex();
const company = "Scale check company";
const batchSize = 10;
let longestBatchMs = 0;
let batchStarted = 0;
const started = performance.now();
for (let index = 0; index < 5_000; index += 1) {
  if (index % batchSize === 0) batchStarted = performance.now();
  const role = `Position ${createHash("sha256").update(String(index)).digest("hex").slice(0, 16)}`;
  const application = { id: String(index), company, role };
  const match = duplicateIndex.find(role);
  if (match) throw new Error(`Unexpected duplicate at ${index}: ${match.kind}`);
  applications.push(application);
  duplicateIndex.add(application);
  if (index % batchSize === batchSize - 1) {
    longestBatchMs = Math.max(longestBatchMs, performance.now() - batchStarted);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
for (const index of [0, 7, 499, 2_500, 4_999]) {
  const original = applications[index];
  for (const role of [original.role, original.role.replace("Position", "POSITION"), `${original.role} I`, original.role.slice(0, -1)]) {
    const expected = findPossibleDuplicate({ company, role }, applications);
    const actual = duplicateIndex.find(role);
    if (actual?.kind !== expected?.kind || actual?.application.id !== expected?.application.id) {
      throw new Error(`Index mismatch for ${role}: expected ${expected?.application.id}/${expected?.kind}, got ${actual?.application.id}/${actual?.kind}`);
    }
  }
}
console.log(JSON.stringify({ records: applications.length, batchSize, elapsedMs: Math.round(performance.now() - started), longestBatchMs: Math.round(longestBatchMs) }));
