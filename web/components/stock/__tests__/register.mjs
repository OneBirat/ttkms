// Node resolver hook so extension-less relative imports in the stock
// module's .ts files ("./helpers") resolve under `node --experimental-strip-types`.
// Run: node --experimental-strip-types --import ./components/stock/__tests__/register.mjs --test "components/stock/__tests__/*.test.mjs"
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { fileURLToPath, pathToFileURL } from "node:url";
      export async function resolve(specifier, context, next) {
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          if (!/\\.[a-z]+$/i.test(specifier) && context.parentURL) {
            const base = new URL(specifier, context.parentURL);
            const file = fileURLToPath(base) + ".ts";
            if (existsSync(file)) return next(pathToFileURL(file).href, context);
          }
        }
        return next(specifier, context);
      }
    `),
  import.meta.url,
);
