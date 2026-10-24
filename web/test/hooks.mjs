// Node module hooks so `node --experimental-strip-types --test` can run the web tests without a
// bundler: "@/..." resolves to web/, extensionless relative imports find .ts/.tsx files, .tsx is
// transpiled with the TypeScript compiler (react-jsx), .json gets its import attribute and CSS
// modules become a proxy that returns the class name.
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const WEB_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

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
    if (isFile(candidate)) {
      const url = pathToFileURL(candidate).href;
      if (candidate.endsWith(".json")) {
        return { url, shortCircuit: true, importAttributes: { type: "json" }, format: "json" };
      }
      if (candidate.endsWith(".tsx") || candidate.endsWith(".css")) {
        return { url, shortCircuit: true, format: "module" };
      }
      return nextResolve(url, context);
    }
  }
  return nextResolve(target, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    const source = "export default new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) });";
    return { format: "module", shortCircuit: true, source };
  }
  if (url.endsWith(".tsx")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
    });
    return { format: "module", shortCircuit: true, source: outputText };
  }
  return nextLoad(url, context);
}
