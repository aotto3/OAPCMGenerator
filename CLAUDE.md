# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OAP Contest Manager **2.0** — a hosted, account-based rebuild of a UIL One-Act Play
contest-document generator. It replaces a single 1.3 MB HTML file (v12) with a
React SPA + thin Node API. All document generation stays **client-side**; the
server is auth + opaque contest storage, plus an append-only activity log, an
admin API, and a telemetry sink (PRD **#54**). Source of truth for intent is the
overall PRD (**issue #13**); the legacy v12 file is the behavior spec.

Two npm workspaces, developed independently:
- `app/` — React + Vite + TypeScript SPA (the whole product lives here, incl. the
  document engine, schedule engine, contest model, local-first storage, sync, the
  owner-only admin panel, and client telemetry).
- `server/` — Express + Better Auth + Postgres API (auth, per-account contest CRUD,
  activity log, telemetry ingest, admin API).

Also: `_Templates/OAP Contest Setup.html` (legacy v12 — **behavior spec, never
edit**), `output/context.md` (v12 conventions: schedule colors, letter language,
PDF field maps, document ordering — read it before touching a generator),
`Adjudicator Packet Templates/` (official UIL ballot PDFs, bundled as assets).

## Commands

Run inside `app/` or `server/` (each has its own `package.json`; there is no root
package). Node 22.

```
# app/
npm install
npm run dev            # Vite dev server (proxies /api → localhost:8080, see vite.config.ts)
npm test               # vitest run — all src/**/*.test.ts
npm run build          # tsc --noEmit (typecheck) + vite build → dist/
npm start              # node serve.mjs — production host (needs API_URL); NOT for dev

# server/
npm install
npm run dev            # tsx watch src/server.ts (needs DATABASE_URL)
npm test               # vitest run — integration tests against an in-memory repo
npm run build          # tsc --noEmit (typecheck only; runtime uses tsx, no compile step)
npm run migrate:auth   # Better Auth CLI — create/update its tables
```

There is **no linter**; `npm run build` (typecheck) is the static gate. Run a
single test file with `npx vitest run src/documents/letter.test.ts`, or one case
with `npx vitest run -t "substring of the test name"`.

### Golden-file tests (the document spec)

Every document generator is verified by **golden-file** comparison, not
hand-written assertions: build the archive from a fixture contest and diff it
against an approved file in `app/src/documents/__fixtures__/golden/`. `.docx`/
`.xlsx` are unzipped and compared as normalized XML per part; the merged
adjudicator PDF is compared by SHA-256. When a generator change is intentional,
re-bless the goldens and **review the diff before committing** (that review is
the approval):

```
cd app && UPDATE_GOLDEN=1 npm test     # rewrites goldens; then git diff to inspect
```

Golden output must stay deterministic — any date a document stamps is injected via
`ctx.now`, never read from the clock.

## Architecture (the big picture)

The system is the six PRD modules, with **one definition of "a contest"** shared
verbatim everywhere:

1. **Contest model** (`app/src/model/contest.ts`) — pure, dependency-free. Fields,
   validation, derived names (v12 formats), versioned serialize/parse with forward
   migrations. Immutable `with*()` updater functions. Nothing here imports from
   elsewhere; everything else imports the `Contest` type from here. `schedule.ts`
   and `critique.ts` are the pure schedule/critique-assignment calculators;
   `checkpoint.ts`/`syncBundle.ts` are the versioned envelopes.

2. **Document engine** (`app/src/documents/`) — a **registry** (`registry.ts`) of
   `{ id, label, filename, defaultSelected, build }`. Both the checkbox UI and the
   ZIP builder (`generate.ts`) are loops over `DOCUMENT_REGISTRY`, so adding a
   document is one registry entry (typed as a total map over `DocumentId`, so a
   missing builder fails to compile). Builders are pure `contest → bytes`; `.docx`
   is hand-written OOXML (`ooxml.ts`), `.xlsx` via `xlsx-js-style`, PDFs via
   `pdf-lib` filling the bundled UIL ballots (`pdfAssets.ts`, loaded by `?url`
   import in browser / `fs` in Node). Only admin/header fields are filled; all
   judge-scored fields stay blank. Filenames match v12's ZIP exactly.

3. **Local-first storage + sync** (`app/src/storage/`) — IndexedDB is the working
   copy (`contestStore.ts` is the only file that touches it; `useAutosave.ts` is
   the one debounced-write pattern). The sync layer (`syncEngine`/`syncClient`/
   `syncStore`/`syncReconcile`/`syncBackoff`/`browserSync`) pushes/pulls to the
   server with **last-write-wins per contest** by `updatedAt`, off the edit path.
   Device-only fields (Speechwire creds) are marked in the model and excluded from
   sync and contest-file export by construction.

4. **Server API** (`server/`) — `app.ts` is a dependency-injected Express factory;
   the seams **are** the constructor args (tests inject in-memory `repo` /
   `eventLog` / `userDirectory` and a fake `resolveUser`), so there is no test-only
   branch. `auth.ts` is Better Auth (Google OAuth + magic link; passwordless).
   Contest storage is **opaque**: the server keeps the `serializeContest` envelope
   + metadata only, never parses contest internals, generates documents, or
   receives credentials, and scopes every query to the owner. Three capabilities
   layer on top (PRD #54): an **append-only activity log** (`eventLog.ts` +
   `events.sql`, applied on boot by `migrate()` alongside `contests.sql`) that
   contest routes append to best-effort; a **telemetry** endpoint
   (`telemetryRoutes.ts`) accepting an allowlisted set of client events
   (`eventTypes.ts`) into that log; and an **admin API** (`adminRoutes.ts`) gated by
   the `ADMIN_EMAILS` allowlist — non-admins get a flat 404, and `userDirectory.ts`
   is the sole reader of Better Auth's user/session tables. The request-auth seam
   resolves `{ id, email }` so events carry both.

5. **App UI** (`app/src/ui/`) — dashboard → workspace (`Workspace.tsx` +
   `sections/`) → generate; `App.tsx` gates on auth (`auth/authClient.ts`).
   Theming is light/dark/system, token-driven (`ui/theme.ts`; the whole app reads
   CSS custom properties, so the dark override in `styles.css` flips everything at
   once — never hard-code a color that a fixed palette doesn't require). `admin/`
   is the owner-only admin panel, rendered only after a positive am-I-admin probe.
   `telemetry/` is the fire-and-forget client (documents generated, contest
   export/import, uncaught errors) — it swallows every failure and is never awaited
   on a user-facing path.

### Deployment shape (important, and non-obvious)

Both services run on **Railway**, deployed from `master`. The frontend and API are
**one origin**: `serve.mjs` (the frontend's `npm start`) serves the SPA **and
reverse-proxies `/api/*` to the API**, so the browser only ever talks to one host.
This is the fix for cross-site auth cookies breaking mobile sign-in (#46):
same-origin ⇒ the Better Auth session cookie is first-party `SameSite=Lax`.

- The proxy in `serve.mjs` is mounted at **root with a `pathFilter`**, not
  `app.use('/api', …)` — Express strips a mount path before the proxy forwards, which
  would drop `/api` and 404 every auth call. Keep it at root.
- `SERVER_URL` and `WEB_ORIGIN` on the API are **both** the single public origin.
  Better Auth builds OAuth callbacks from `SERVER_URL`; it must be the origin the
  browser uses, not the API's internal URL.
- The frontend's `API_URL` (runtime, read by `serve.mjs`) is the API's internal
  Railway URL. `VITE_API_URL` is unset (the app calls relative `/api`).
- **Admin access is the `ADMIN_EMAILS` env var on the API** (comma-separated). A
  session is admin iff its email is listed; everyone else gets 404 on `/api/admin/*`
  and never sees the panel. Additive — granting/revoking admin is a config change,
  no migration and no auth cutover.
- A live **service worker** (`vite-plugin-pwa`, `prompt` update flow) means an
  already-open client updates only when the user accepts the "new version" prompt —
  a hard refresh alone may serve the cached bundle. Frontend builds lag a merge by
  ~10 min. See `memory/oap-2.0-deployment.md` for URLs and the full history.

## Conventions and invariants

- **Never edit `_Templates/OAP Contest Setup.html`** — it is the frozen behavior
  spec. Port its logic; the golden tests lock the port.
- Generated output must open cleanly in **Google Sheets/Drive** (no Word SDT
  checkboxes; cell colors/validation must survive import) — see `output/context.md`
  constraints.
- Tests assert **observable behavior at module boundaries** (inputs → outputs),
  never internals, so they survive refactors. No automated browser/UI tests — the
  admin panel and theme UI are untested by convention; their server seams are not.
- The **activity log is append-only and best-effort**: contest routes record
  create/update/delete inline, but a logging failure must never fail or delay the
  user's request; delete events keep the contest name so the trail outlives the row.
- **Telemetry types are a fixed server allowlist** (`server/src/eventTypes.ts`,
  mirrored in `app/src/telemetry/telemetryClient.ts`); the endpoint 400s unknown
  types and size-caps `detail`. The admin surface is **dark to non-admins** (404,
  never 401/403) so it cannot be probed.
- **Commit messages: never add a `Co-Authored-By` trailer** (see
  `memory/no-coauthored-by.md`).
- A `server/` change triggers an API redeploy. Auth/cookie changes can require a
  cutover — coordinate, don't merge them blind; additive routes (log, telemetry,
  admin) do not.
