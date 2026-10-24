// `node --experimental-strip-types --import ./test/register.mjs --test <globs>` (see package.json).
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
