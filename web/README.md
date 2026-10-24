# TTK web (Next.js frontend)

Next 15 / React 19 / TypeScript, plain CSS (global tokens in `app/globals.css`
and one CSS module per component). No Tailwind, no Google Fonts, no CDN assets:
the app runs on a LAN without internet.

## Run

```sh
npm install
API_URL=http://localhost:8000 npm run dev -- --port 3000
```

Then open http://localhost:3000. `API_URL` is the origin of the FastAPI
backend; copy `.env.example` to `.env.local` to set it (and `PORT`) once.

Checks: `npm run lint`, `npx tsc --noEmit`, `npm run build` (then `npm start`).
Pages are client-rendered and never call the API at build time, so the build
works without a running backend.

## Proxy model (no CORS)

`next.config.ts` rewrites `/api/:path*`, `/health` and `/core/export-demo.:ext`
to the backend. The browser only ever talks to the Next.js origin, so the
`ttk_session` cookie (HttpOnly, SameSite=Lax) stays same-origin and there is no
CORS configuration anywhere. Rewrites are evaluated when the server starts
(`next dev`) or at `next build`, so set `API_URL` for that process.

- `middleware.ts` redirects app pages to `/login?next=...` when the cookie is
  missing; the API remains the real guard and every 401 also sends the user to
  `/login` (`lib/api.ts`).
- Unsafe requests carry `X-CSRF-Token`; the token is kept in `lib/api.ts` and
  refreshed from every `{user, csrf_token}` response and `GET /api/auth/csrf`.

## Where things live

- `app/globals.css`: @font-face (self-hosted in `public/fonts/`), design tokens
  (`--color-*`, `--pill-*`, `--radius-*`, `--font-ui|mono|np`), base styles and
  the shared `.card`, `.btn`, `.input`, `.label`, `.skip-link` classes.
- `lib/api.ts`: contract types, `apiFetch<T>()`, `ApiError`, `ensureCsrf()`.
- `lib/session.tsx`: `SessionProvider` / `useSession()` (user, modules, enabled,
  isEnabled, today, logout) loaded once for the app shell from `/api/core/modules`.
- `lib/modules.ts`: pure helpers over `/api/core/modules` (`moduleForPath`,
  `homePath`, `enabledOnly`), shared by `middleware.ts`, the login page and the
  dashboard; unit-tested with `npm test`.
- `lib/bs/`: the Bikram Sambat calendar (conversions over `calendar-data.json` +
  `calendar-overrides.json`, the same files the backend reads), Nepal time,
  month / fiscal-year helpers, English and Nepali formatting, range presets.
  See `docs/bs-calendar.md`.
- `components/date/`: `BSDate`, `BSDatePicker`, `BSDateRangePicker`,
  `BSDateTimePicker`, `DateLangToggle` (demo at `/dev/date-picker` in dev).
- `components/`: `AppShell`, `Sidebar`, `Header`, `Dashboard`,
  `ModulePlaceholder`, `icons.tsx`, `widgets/` (dashboard widgets by `kind`)
  and `ui/` (PageHeader, StatCard, Pill, DataTable, Modal, Segmented,
  EmptyState, Pagination).
- `app/`: routes. `(app)/` is the authenticated shell (dashboard, attendance,
  payroll, admin, module-off; `stock/` stays in the tree but is paused, see the
  root README); `login/` is the sign-in page. `middleware.ts` redirects pages of
  a module missing from the backend's `ENABLED_MODULES` to `/module-off`.

## Worktrees

Each git worktree has its own `web/` (and its own `node_modules`). Run it on
its own port with `API_URL` pointing at that worktree's backend, e.g. worktree
1 on 3001 against the backend on 8001:

```sh
API_URL=http://localhost:8001 npm run dev -- --port 3001
```

Use 3001-3004 / 8001-8004 so several worktrees can run side by side.
