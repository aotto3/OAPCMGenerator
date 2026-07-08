# OAP Contest Manager 2.0 — Architecture

A technical tour of how the app is built and *why*, for developers and for future
AI assistants changing the codebase. For day-to-day commands and invariants see
[CLAUDE.md](CLAUDE.md); for the product intent, PRD **issue #13**; for the exact
v12 conventions the generators reproduce, [`output/context.md`](output/context.md).

---

## 1. What problem the design solves

The predecessor (v12) was a single ~1.3 MB HTML file: ~100 functions, all CSS, all
markup, and three base64-embedded PDFs fused together. It worked, but it had three
structural problems the rebuild targets directly:

- **Ambiguous persistence.** Three overlapping save mechanisms (browser snapshots,
  a 1.3 MB "Regenerate.html" clone in every ZIP, and the live form) that drifted
  apart. → 2.0 has **one** authoritative contest record with one autosave path.
- **Untestable and hazardous to edit.** Everything in one file, no tests. → 2.0 is
  small purpose-specific modules with a **golden-file** test suite that locks
  document output byte-for-byte.
- **Doesn't scale to distribute.** Hand-shared HTML file. → 2.0 is a hosted SPA with
  accounts, so every user gets the latest version at one URL.

The guiding constraint: **the generated documents must not change.** v12's output is
the specification; the generator logic is *ported, not rewritten*, and the golden
tests are what prove the port is faithful.

## 2. The central idea: one definition of "a contest"

Everything orbits a single pure module, `app/src/model/contest.ts`. It defines the
`Contest` record, its validation, its derived values (e.g. the contest's full name
and ZIP folder name in v12's exact format), and a **versioned serialize/parse with
forward migrations**. The UI, the autosave layer, the sync layer, the contest-file
codec, and the server all speak this one type. There is exactly one place that
knows what a contest *is*.

Consequences that shape the whole codebase:

- **The model imports nothing.** No React, no DOM, no IndexedDB, no `fetch`. This is
  what makes it trivially testable and safely shareable across the browser and Node.
- **Updates are immutable.** State changes go through `with*()` functions
  (`withIdentity`, `withSchool`, `withAdjudicator`, …) that return a new record with
  a bumped `updatedAt`. This gives sync a clean per-contest clock and makes React
  re-renders predictable.
- **Device-only fields are declared in the schema** (Speechwire credentials). They
  are excluded from sync and from contest-file export *by construction*, not by
  remembering to strip them at each boundary.

Two sibling pure modules live alongside it:
- `schedule.ts` — the schedule engine: `contest (+ optional overrides) → timeline`.
  Ports v12's rules exactly (50-min first slot, 40-min subsequent, after-each vs.
  after-all critique sequencing, strike/tabulation/awards blocks). The `overrides`
  parameter is empty in v1 but is part of the contract so future manual timing edits
  are additive, not a rewrite.
- `critique.ts` — the critique-assignment randomizer (judge-per-show assignment
  respecting UIL rules, with lock/reorder semantics).

## 3. Module map and dependency rules

```
app/src/
  model/       contest, schedule, critique, checkpoint, syncBundle   (PURE — imports nothing app-local)
  documents/   registry + one builder per document + OOXML/xlsx/pdf helpers + golden harness
  storage/     IndexedDB working copy + background sync (last-write-wins)
  ui/          dashboard → workspace → generate; auth gate
  auth/        Better Auth browser client + sign-in screen
server/src/    Express factory, Better Auth, Postgres repo, contest routes
```

The dependency arrows point *inward* toward the model. `documents/`, `storage/`,
`ui/`, and `server/` all depend on `model/`; `model/` depends on none of them. When
adding code, preserve this: put pure logic in `model/`, keep side effects (DOM,
IndexedDB, network, `fs`) at the edges.

## 4. Document engine

The engine is a **registry**, `documents/registry.ts`. Each document is one entry:

```ts
{ id, label, filename, defaultSelected, build }   // build: contest → bytes
```

`DOCUMENT_REGISTRY` is derived from the model's `DOCUMENT_TYPES` (so id/label/default
have one definition) and the per-id builder map is typed as a **total map over
`DocumentId`** — forget to register a builder for a new document id and it fails to
compile. Both the document-selection checkboxes and the ZIP builder
(`generate.ts` → `buildContestArchive`) are just loops over this registry. Adding a
document is: add the id to the model, add one registry entry, add its golden file.
No UI or packaging edits.

Builder mechanics:
- **`.docx`** is hand-written **OOXML** via helpers in `ooxml.ts` (`ooP`, `ooTable2Col`,
  `makeDocx`, …) packed with JSZip. There is deliberately no Word-document library:
  v12's exact formatting (fonts, sizes, spacing, no SDT checkboxes so it renders in
  Google Drive) is reproduced at the XML level.
- **`.xlsx`** uses `xlsx-js-style` with cell styles, because the schedule's colors
  and layout must survive a Google Sheets import.
- **PDF** (`adjPackets.ts` + `pdfAssets.ts`) fills the **official UIL ballot PDFs**
  with `pdf-lib`. The ballots are bundled static assets loaded via a `?url` import in
  the browser and `fs` in Node (`loadAdjudicatorTemplates`). Only admin/header fields
  are filled; every rating/comment field is left blank for judges to complete on
  paper. Forms are flattened, then pages are merged into one PDF in judge order.
- A builder may return `{ bytes, warnings }`; the PDF filler reports non-fatal
  field-fill failures as warnings the generate pipeline surfaces without aborting the
  ZIP (v12's `fieldErrors`).

Builders are pure and deterministic. Any "today's date" a document stamps is passed
in via `DocumentBuildContext.now`, so golden output never depends on the clock.

### Why golden files

Documents are the product, and they are high-churn XML where a one-character change
is a real regression. So each generator is tested by building from a fixture contest
(`__fixtures__/fixtureContest.ts` — fully populated, with `Romeo & Juliet` to
exercise XML escaping and out-of-order draws to exercise sorting) and diffing the
result against an approved golden in `__fixtures__/golden/`.

The harness (`goldenFile.ts`) normalizes to avoid false diffs: a `.docx`/`.xlsx` is a
ZIP whose entry timestamps and order vary run-to-run, so it **unzips both sides and
compares each inner part as normalized text keyed by path**. The merged PDF has no
meaningful text diff, so it's compared by **SHA-256** once its bytes are made
deterministic. `UPDATE_GOLDEN=1` rewrites the goldens; the human review of that git
diff is the approval step. This is the mechanism that let the v12 logic be ported
with confidence.

## 5. Local-first storage and sync

The app must work fully offline on contest day (a theatre with no wifi), so the
browser is the source of truth and the server is a backup/roaming layer.

- **IndexedDB is the working copy.** `contestStore.ts` is the *only* file that touches
  IndexedDB; `useAutosave.ts` is the *only* autosave pattern — a debounced write on
  every change, flushed on page leave. There is no Save button.
- **Sync runs off the edit path.** `syncEngine.ts` orchestrates push/pull;
  `syncClient.ts` is the only file that calls the API; `syncStore.ts` is its IndexedDB
  adapter; `syncReconcile.ts` does **last-write-wins per contest** by `updatedAt`;
  `syncBackoff.ts` handles retry; `browserSync.ts` wires it to online/offline events.
  Errors are classified (`SyncNetworkError` transient, `SyncHttpError` by status —
  401 = auth lost, 5xx/429 = retry) so nothing the user types ever waits on the
  network.
- **Checkpoints** are immutable copies of the contest record with a name/note/
  timestamp. They are folded into the contest's opaque payload
  (`{ schemaVersion, contest, checkpoints }`) rather than a separate server table —
  the existing server validation accepts the superset, so no new server surface was
  needed.
- **Trade-off:** last-write-wins with no tombstones means an offline delete can be
  resurrected by a later pull. Documented and accepted per PRD.

## 6. Server

`server/src/app.ts` is a **dependency-injected Express factory**. The integration
tests build the exact production app minus the two things they can't run offline: a
real Postgres (they inject an in-memory `repo`) and a real Better Auth session (they
inject a fake `resolveUserId`). There is no test-only branch anywhere — the seams
*are* the constructor arguments, which keeps the deployed code and the tested code
identical.

- **Auth** (`auth.ts`) is **Better Auth** — passwordless by design (Google OAuth +
  emailed magic link), never hand-rolled. Sessions/users/OAuth-accounts/magic-link
  tokens live in Postgres (Better Auth owns those tables; `npm run migrate:auth`).
  Email goes out via MailerSend's REST API (`email.ts`); if unconfigured, the magic
  link is logged to the console for local dev.
- **Storage** (`contestRepo.ts`, `contestRoutes.ts`, `contestPayload.ts`) is
  deliberately dumb: it stores the **opaque** `serializeContest` envelope plus minimal
  metadata (name, updatedAt). The server never parses contest internals, never
  generates a document, and rejects payloads carrying device-only credentials. Every
  query is scoped by the authenticated owner. This keeps hosting cheap and low-risk
  and leaves the door open to paid tiers without a data migration.

## 7. Deployment and the single-origin auth architecture

Both services run on **Railway**, deployed from `master`. The critical, non-obvious
piece is that **the frontend and API are served as one origin**.

**Why.** Better Auth uses cookies for the OAuth `state` and the session. When the
frontend and API are different sites, those cookies are cross-site and must be
`SameSite=None; Secure` — which mobile Safari/Chrome block as third-party cookies, so
Google sign-in ends in `state_mismatch` and magic-link sessions don't persist. On
Railway this was unavoidable with two `*.up.railway.app` hosts, because
`up.railway.app` is on the Public Suffix List (each app is its own site).

**The fix (Slice 17, #46).** `app/serve.mjs` — the frontend's production `npm start`
— serves the built SPA **and reverse-proxies `/api/*` to the API**. The browser only
ever talks to the frontend origin, so the session cookie is first-party
`SameSite=Lax` and mobile works. Details that matter if you touch this:

- The proxy is mounted at **root with `pathFilter: p => p.startsWith('/api')`**, not
  `app.use('/api', …)`. Express strips a mount path before the middleware forwards,
  which would drop `/api` and make the API 404 every auth call
  (`Cannot POST /auth/sign-in/...`). This exact bug shipped and was caught in live
  testing — keep it at root.
- On the API, `SERVER_URL` **and** `WEB_ORIGIN` are **both** the single public origin
  (the frontend URL). Better Auth builds the Google callback from `SERVER_URL`, so it
  must be the origin the browser uses, not the API's internal URL. Cookie policy is
  `SameSite=Lax` (Secure on https); `trust proxy` is set so `req.protocol` reflects
  `X-Forwarded-Proto`. `GET /` on the API 302-redirects to the app (no more
  `Cannot GET /`).
- The frontend's `API_URL` (runtime env read by `serve.mjs`) is the API's internal
  Railway URL — the proxy target. `VITE_API_URL` is unset; the app calls relative
  `/api` and `vite dev` proxies the same way (`vite.config.ts`).
- **PWA:** a Workbox service worker (`vite-plugin-pwa`, `prompt` update flow)
  precaches the shell + generation JS + ballot PDFs for offline use. Updates are *not*
  silent — a new deploy waits until the user accepts the in-app "new version" prompt,
  so a Generate in progress on contest day is never interrupted. Practical effect:
  after a deploy, an already-open device may serve the cached bundle until the prompt
  is accepted; a hard refresh alone isn't always enough.

**Domain note.** The intended pretty domain `oapmanager.allenotto.com` was abandoned
because Railway needs a `_railway-verify` TXT under the subdomain, and Wix's
nameservers won't serve a TXT under a CNAME'd name. The live entry point is a Wix
`allenotto.com/oapmanager` **301 redirect** to the Railway frontend URL. Moving to a
real custom domain later means migrating `allenotto.com` DNS to Cloudflare. Full
history and live URLs are in `memory/oap-2.0-deployment.md`.

## 8. How to extend (common changes)

- **Add a document.** Add its id/label/default to `DOCUMENT_TYPES` in the model, add a
  builder file + a `DOC_BUILDERS` entry in `documents/registry.ts`, then
  `cd app && UPDATE_GOLDEN=1 npm test` to write the golden and review the diff. The
  checkbox UI and ZIP builder pick it up automatically.
- **Add a contest field.** Add it to the `Contest` type + validation in
  `model/contest.ts`, thread it through the relevant `with*()` updater and the UI
  section, and — if it changes the serialized shape — bump the schema version and add
  a **forward migration** so old saved records still parse. Add model tests for the
  round-trip and migration.
- **Change generated content.** Edit the builder, run `UPDATE_GOLDEN=1`, and treat the
  golden diff as the review. If it touches letter language, schedule format, colors,
  or PDF field maps, re-read `output/context.md` first — those are frozen v12
  conventions with explicit constraints.
- **Change auth or cookies.** This is a `server/` change → API redeploy → an auth
  cutover. Test the endpoints through the proxy (not just the API directly) and verify
  on a real mobile device; desktop is more permissive and will hide cookie bugs.

## 9. Constraints that are not negotiable

- Official UIL PDF forms must be used as-is; only admin/header fields are filled.
- Letter language is fixed 2026 wording — variable substitution only.
- Output must open natively in Google Sheets/Drive (colors, validation survive
  import; no Word SDT checkboxes).
- All document generation is client-side; the server never generates anything.
- Never edit the v12 file `_Templates/OAP Contest Setup.html`; it is the spec.
