// Node resolver hook so the stock module's .ts files run under
// `node --experimental-strip-types`: extension-less relative imports ("./helpers")
// get ".ts", and the "@/..." alias from tsconfig resolves to web/.
// Run: node --experimental-strip-types --import ./components/stock/__tests__/register.mjs --test "components/stock/__tests__/*.test.mjs" lib/*.test.ts
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const webRoot = pathToFileURL(new URL("../../../", import.meta.url).pathname).href;

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { fileURLToPath, pathToFileURL } from "node:url";
      const WEB_ROOT = ${JSON.stringify(webRoot)};
      function withTs(url) {
        const file = fileURLToPath(url);
        for (const candidate of [file, file + ".ts", file + ".tsx"]) {
          if (existsSync(candidate) && !candidate.endsWith("/")) return pathToFileURL(candidate).href;
        }
        return null;
      }
      export async function resolve(specifier, context, next) {
        if (specifier.startsWith("@/")) {
          const found = withTs(new URL(specifier.slice(2), WEB_ROOT));
          if (found) return next(found, context);
        }
        if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL && !/\\.[a-z]+$/i.test(specifier)) {
          const found = withTs(new URL(specifier, context.parentURL));
          if (found) return next(found, context);
        }
        return next(specifier, context);
      }
    `),
  import.meta.url,
);
