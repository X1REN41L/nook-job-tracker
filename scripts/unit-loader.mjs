import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

export function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (specifier.startsWith("@/")) {
    target = pathToFileURL(resolvePath(sourceRoot, specifier.slice(2))).href;
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith(pathToFileURL(sourceRoot).href)) {
    target = new URL(specifier, context.parentURL).href;
  }
  if (target.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(new URL(target).pathname)) {
    const path = fileURLToPath(target);
    if (existsSync(`${path}.ts`)) target = pathToFileURL(`${path}.ts`).href;
  }
  const resolved = nextResolve(target, context);
  if (resolved.url.startsWith(pathToFileURL(sourceRoot).href) && new URL(resolved.url).pathname.endsWith(".ts")) {
    return { ...resolved, format: "module-typescript" };
  }
  return resolved;
}
