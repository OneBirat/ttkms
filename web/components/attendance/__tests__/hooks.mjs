// Node module hooks so `node --experimental-strip-types --test` can run the
// attendance helper tests without a bundler: resolves the "@/..." alias to
// web/ and extensionless relative imports to .ts files.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const WEB_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (specifier.startsWith("@/")) {
    target = pathToFileURL(resolvePath(WEB_ROOT, specifier.slice(2))).href;
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    target = new URL(specifier, context.parentURL).href;
  } else {
    return nextResolve(specifier, context);
  }
  const path = fileURLToPath(target);
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(target, context);
}
