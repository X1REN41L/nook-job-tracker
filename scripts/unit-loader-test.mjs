import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { resolve } from "./unit-loader.mjs";

const projectURL = new URL("../", import.meta.url);
const sourceURL = new URL("src/", projectURL);

test("source TypeScript has an explicit format with aliases and relative imports preserved", () => {
  const context = { parentURL: new URL("lib/backup-snapshot.ts", sourceURL).href };
  const expectedURL = new URL("lib/settings-defaults.ts", sourceURL).href;
  for (const specifier of ["@/lib/settings-defaults", "./settings-defaults", expectedURL]) {
    const result = resolve(specifier, context, (target, passedContext) => {
      assert.equal(target, expectedURL);
      assert.equal(passedContext, context);
      return { url: target, format: null, customMetadata: true };
    });
    assert.equal(result.format, "module-typescript");
    assert.equal(result.customMetadata, true);
  }
});

test("dependency, CommonJS, JSON and files outside src retain their formats", () => {
  for (const [path, format] of [
    ["node_modules/dependency/index.ts", "commonjs-typescript"],
    ["src/lib/example.cts", "commonjs-typescript"],
    ["src/lib/example.cjs", "commonjs"],
    ["src/lib/example.json", "json"],
    ["scripts/example.ts", null],
    ["src-other/example.ts", null],
    ["src/lib/example.js", "commonjs"],
  ]) {
    const original = { url: new URL(path, projectURL).href, format };
    assert.equal(resolve(original.url, {}, () => original), original, path);
  }
  const builtin = { url: "node:fs", format: "builtin" };
  assert.equal(resolve(builtin.url, {}, () => builtin), builtin);
});

test("registered hooks import TypeScript without the package reparsing warning", () => {
  const result = spawnSync(process.execPath, [
    "--import", new URL("unit-loader-register.mjs", import.meta.url).href,
    "--input-type=module", "--eval", "await import('@/lib/settings-defaults');",
  ], { cwd: projectURL, encoding: "utf8", timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module/);
});
