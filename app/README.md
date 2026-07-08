# OAP Contest Manager 2.0 (`app/`)

The hosted rebuild of the OAP Contest Manager (PRD: issue #13). The legacy
v12 single-file app lives at `_Templates/OAP Contest Setup.html` and is the
behavior spec — **never edit it**; `output/context.md` documents its
conventions.

## Toolchain

Vite + React + TypeScript, tested with vitest. `npm run build` produces a
plain static site; all document generation and storage stay client-side
(local-first). The only backend is the thin auth/storage API in `../server`
(Slice 13, PRD module 5): the app signs in against it (Google OAuth + magic
link) and — from Slice 14 on — syncs contests to it. Set `VITE_API_URL` to the
API origin (see `.env.example`).

```
npm install     # once
npm run dev     # dev server
npm test        # vitest, runs src/**/*.test.ts
npm run build   # typecheck + static build to dist/
```

## Layout and module boundaries

```
src/
  model/     Contest model — THE definition of "a contest". Pure TypeScript:
             no React, no DOM, no IndexedDB, no fetch. Fields, validation,
             derived names (v12 formats), versioned serialize/parse with
             forward migrations. Fully unit-tested. Everything else imports
             the contest type from here; nothing here imports anything else.
  storage/   Local-first persistence AND background sync. contestStore.ts is the
             only file that touches IndexedDB; useAutosave.ts is the one autosave
             pattern (debounced write on every state change, flush on leave).
             The sync layer lives here too (Slice 14, issue #27), never in the
             UI: syncEngine.ts orchestrates push/pull with last-write-wins per
             contest (syncReconcile.ts), an in-memory offline queue, and
             retry/backoff (syncBackoff.ts); syncClient.ts is the only place that
             calls the API; syncStore.ts is the IndexedDB adapter; browserSync.ts
             wires it to the browser. It runs off the edit path — contestStore
             publishes a change after each write and the engine schedules an
             async flush, so typing never waits on the network.
  ui/        React components. They hold a Contest in state, edit it through
             model helpers, and persist via useAutosave. UI components never
             import `idb` or build serialization formats themselves.
```

Dependency direction is one-way: `ui → storage → model`. Keep it that way —
it is what makes the model reusable by the sync layer, the contest-file
codec, and the server later.

## Conventions later slices must follow

- **No Save button for routine edits.** Edits update state; `useAutosave`
  persists them. (Named checkpoints — a manual "save with note" — come in a
  later slice per PRD #13; they layer on top of autosave, they don't replace
  it.)
- **New contests are in-memory drafts** until the first edit; an accidental
  "+ New Contest" click must never leave a stored contest behind.
  `useAutosave` enforces this by skipping contests whose `updatedAt` still
  equals `createdAt`.
- **Derived strings live in the model** (`contestDisplayName`, etc.), never
  recomputed ad hoc in components. v12's exact formats are load-bearing.
- **Schema changes**: bump `CONTEST_SCHEMA_VERSION`, add a migration step in
  `MIGRATIONS`, and add a round-trip + migration test. Never edit existing
  migration steps.
- **Never put a network call on the edit path.** Sync reacts to storage
  writes and runs asynchronously; nothing the user types waits on the server.
- **Checkpoints ride the contest's sync bundle**, not their own endpoint. The
  wire payload is `{ schemaVersion, contest, checkpoints }` — a superset of the
  `serializeContest()` envelope the server stores opaquely (`model/syncBundle.ts`).
  A checkpoint-only change nudges the contest's `updatedAt` so it propagates
  under last-write-wins-per-contest.
- **Device-only fields never leave the device.** `serializeContest()` strips
  Speechwire, the server rejects credential-bearing payloads, and
  `syncBundle.test.ts` / `syncEngine.test.ts` assert it at the wire level.
- **Tests assert module-boundary behavior** (inputs → outputs), not
  implementation details. UI and multi-device/offline sync flows are verified
  manually in v1 (PRD decision); the sync logic (LWW, offline queue,
  retry/backoff, device-only exclusion) is unit-tested at its seams.
- Boring choices on purpose: no state-management library, no router yet
  (App.tsx holds one `openContestId`), no CSS framework. Add them only when
  a slice actually needs them.
