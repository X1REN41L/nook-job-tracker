import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/duplicate-match.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { findPossibleDuplicate, normalizeDuplicateText } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const application = (id, company, role) => ({ id, company, role });
const existing = [
  application("openai", "OpenAI", "Software Engineer"),
  application("acme", "Acme", "Front-End Developer"),
];

assert.equal(normalizeDuplicateText("  Software   Engineer  "), "software engineer");

assert.equal(
  findPossibleDuplicate({ company: "OpenAI", role: "Software Engineer" }, existing)?.kind,
  "exact",
);
assert.equal(
  findPossibleDuplicate({ company: "openai", role: "software engineer" }, existing)?.kind,
  "exact",
);
assert.equal(
  findPossibleDuplicate({ company: "  OpenAI  ", role: "Software   Engineer" }, existing)?.kind,
  "exact",
);
assert.equal(
  findPossibleDuplicate({ company: "OpenAI", role: "Software Engineer I" }, existing)?.kind,
  "close",
);
assert.equal(
  findPossibleDuplicate({ company: "Acme", role: "Frontend Developer" }, existing)?.kind,
  "close",
);
assert.equal(
  findPossibleDuplicate({ company: "OpenAI", role: "Product Designer" }, existing),
  null,
);
assert.equal(
  findPossibleDuplicate({ company: "Anthropic", role: "Software Engineer" }, existing),
  null,
);
assert.equal(
  findPossibleDuplicate({ company: "OpenAI", role: "Software Engineer" }, existing, "openai"),
  null,
);

console.log("Passed: exact, normalized, close, unrelated, and self-exclusion duplicate matching.");
