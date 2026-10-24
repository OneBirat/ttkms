# Web tests

Node's built-in runner, no extra dependency. From `web/`:

```sh
npm test            # everything: lib/**, components/**  (*.test.ts, *.test.tsx, *.test.mjs)
```

`test/register.mjs` installs the module hooks in `test/hooks.mjs`: `@/` alias, extensionless
imports, `.tsx` through the TypeScript compiler, JSON imports and CSS-module stubs. `make test` at
the repo root runs pytest and then this.
