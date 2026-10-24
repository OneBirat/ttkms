# Attendance helper tests

Pure-helper tests with Node's built-in runner (no extra dependency). From `web/`:

```sh
node --experimental-strip-types --import ./components/attendance/__tests__/register.mjs \
  --test "components/attendance/__tests__/*.test.ts"
```

Requested for `web/package.json` on main: `"test:attendance"` with that command.
