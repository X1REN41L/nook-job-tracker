import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { workerData } from "node:worker_threads";

// The local Node server executes the same TypeScript validators as Next, in a worker.
const sourceRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = specifier;
    if (specifier.startsWith("@/")) target = pathToFileURL(resolvePath(sourceRoot, specifier.slice(2))).href;
    else if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(sourceRoot).href)) target = new URL(specifier, context.parentURL).href;
    if (target.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(new URL(target).pathname)) {
      const path = fileURLToPath(target);
      if (path.startsWith(`${sourceRoot}/`)) target = pathToFileURL(`${path}.ts`).href;
    }
    const resolved = nextResolve(target, context);
    if (resolved.url.startsWith(pathToFileURL(sourceRoot).href) && resolved.url.endsWith(".ts")) return { ...resolved, format: "module-typescript" };
    return resolved;
  },
});
await import(workerData.export ? "./backup-export.worker.ts" : "./backup-staging.worker.ts");
