// Node resolver hook so the payroll module's .ts files run under
// `node --experimental-strip-types --test`: extension-less relative imports
// ("./calc") resolve to .ts, and the "@/lib/x" alias resolves to web/lib/x.ts.
// Run from web/:
//   node --experimental-strip-types --import ./components/payroll/__tests__/register.mjs --test "components/payroll/__tests__/*.test.mjs"
import { register } from "node:module";

const webRoot = new URL("../../../", import.meta.url).href;

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { fileURLToPath, pathToFileURL } from "node:url";
      const WEB_ROOT = ${JSON.stringify(webRoot)};
      function withTs(url) {
        const file = fileURLToPath(url);
        for (const ext of [".ts", ".tsx"]) {
          if (existsSync(file + ext)) return pathToFileURL(file + ext).href;
        }
        return null;
      }
      export async function resolve(specifier, context, next) {
        if (specifier.startsWith("@/")) {
          const base = new URL(specifier.slice(2), WEB_ROOT);
          const hit = withTs(base);
          if (hit) return next(hit, context);
        }
        if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
          if (!/\\.[a-z]+$/i.test(specifier)) {
            const hit = withTs(new URL(specifier, context.parentURL));
            if (hit) return next(hit, context);
          }
        }
        return next(specifier, context);
      }
    `),
  import.meta.url,
);
