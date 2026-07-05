# OAP Contest Manager 2.0 (`app/`)

The hosted rebuild of the OAP Contest Manager (PRD: issue #13). The legacy
v12 single-file app lives at `_Templates/OAP Contest Setup.html` and is the
behavior spec — **never edit it**; `output/context.md` documents its
conventions.

## Toolchain

Vite + React + TypeScript, tested with vitest. `npm run build` produces a
plain static site — there is no server anywhere in this app; all document
generation and storage is client-side (local-first).

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
  storage/   Local-first persistence. contestStore.ts is the only file that
             touches IndexedDB; useAutosave.ts is the one autosave pattern
             (debounced write on every state change, flush on leave). The
             future sync layer plugs in here, not in the UI.
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
- **Tests assert module-boundary behavior** (inputs → outputs), not
  implementation details. UI is verified manually in v1 (PRD decision).
- Boring choices on purpose: no state-management library, no router yet
  (App.tsx holds one `openContestId`), no CSS framework. Add them only when
  a slice actually needs them.
