import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// Next's settings.next.rootDir reaches fast-glob -> micromatch -> braces.
// Keep lint configuration and any future rootDir patterns repository-controlled.
// GHSA-vfj7-8cjw-p6xm remains open pending a compatible upstream dependency fix.
export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", ".next-playwright/**", ".next-playwright.*/**", "out/**", "next-env.d.ts", "tsconfig.playwright.json"]),
]);
