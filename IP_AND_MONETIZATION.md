# IP Protection & Monetization Path

How ownership of OAP Contest Manager is asserted today, and the concrete path to
charging for it later. Written so a future maintainer (or AI assistant) can pick
up either thread without re-deriving the strategy.

---

## The honest constraint (read this first)

All document generation runs **client-side** — the generator JavaScript is shipped
to every visitor's browser. That is deliberate (it's what makes the app work
offline on contest day), but it means:

- You **cannot** keep the generation algorithm secret. A determined developer can
  read the minified bundle and, once loaded, generate documents offline.
- Therefore IP protection here is **legal + attribution + access control**, not
  secrecy. The value is the hosted service (the one URL, accounts, sync, updates,
  convenience), not a hidden algorithm.

This is the same posture as most SaaS. It's fine — just don't build on the
assumption that the code is private.

## What's in place now (Slice: IP attribution)

1. **Copyright + proprietary license.** [`LICENSE`](LICENSE) declares the software
   "all rights reserved," not open source. The repo's default state is already
   "all rights reserved"; the file makes it explicit and names the third-party
   materials (UIL ballots, OSS deps).
2. **Terms of Use.** [`app/public/terms.html`](app/public/terms.html) (served at
   `/terms.html`) states ownership, the personal/revocable permission end users
   get, and prohibited uses (copying, reverse-engineering to compete, reselling
   access). Users pass through it at the hosted app. Paired with the existing
   `/privacy.html`.
3. **In-app © notice.** A footer in `app/src/ui/App.tsx` shows
   "© 2026 Allen Otto · OAP Contest Manager" with links to Terms and Privacy in
   every state.
4. **Invisible authorship in generated files.** Every `.docx`, `.xlsx`, and `.pdf`
   carries the author/creator in its **hidden document properties** (not on the
   page — so the official UIL forms are untouched). The single source of these
   strings is [`app/src/documents/attribution.ts`](app/src/documents/attribution.ts);
   they are stamped in `ooxml.ts` (`docProps/core.xml` + `app.xml`), `xlsx.ts`
   (`wb.Props`), and `adjPackets.ts` (`pinMetadata` → `setAuthor`). All static
   strings, so output stays deterministic; the golden files were re-blessed to
   include them.

Deliberately **not** done: visible watermarks on the documents. They are official
contest paperwork (the adjudicator packets are the literal UIL ballots — fill
admin fields only, use the forms as-is), so a visible "made by" stamp would be
inappropriate. Brand the app, not the paperwork.

## Trademark & naming (optional, future)

The name "OAP Contest Manager" and any logo could be registered as a trademark to
strengthen brand protection. Not required to operate; note it as an option if the
product goes wide.

## Monetization path (nothing built yet — by PRD design)

The architecture was built to keep this door open (PRD: accounts from day one; the
server is a thin, gate-able storage/auth layer). Adding paid tiers later is
**pure addition, no rewrite**:

1. **Entitlement field.** Add a per-user `plan` / `entitlement` (default `free`) —
   either as a Better Auth user additional field or a small `entitlements` table
   keyed by user id (server change → one migration → API redeploy).
2. **Server-side gate.** Add a check in the contest routes / a middleware that
   reads the entitlement and gates the relevant action (e.g. number of contests,
   or access at all). The server already owner-scopes every query, so this is a
   natural extension — keep the gate in `server/`, never in the contest model.
3. **Payments (Stripe).** Add Stripe Checkout for purchase and a **webhook**
   endpoint that flips the user's entitlement on `checkout.session.completed` /
   subscription events. The Express + Postgres server takes a webhook trivially;
   store only the entitlement + a customer/subscription id, nothing sensitive.
4. **UI tiering.** Reflect the entitlement in the UI (upgrade prompt, gated
   controls). Keep the contest model unaware of billing — gate at the API + UI.

**Access-control reality:** because generation is client-side, the enforceable
lever is the **account/service** — no account ⇒ no saved contests, no sync, no
hosted convenience. Gate sign-in/sync/storage server-side; don't expect to bill
per generated document. For this product that's sufficient: you control the one
URL and the deploy.

**Suggested first step when the time comes:** implement step 1 (the entitlement
seam, defaulting everyone to `free` and gating nothing) as its own small slice, so
the schema and gate exist before any payments code lands.
