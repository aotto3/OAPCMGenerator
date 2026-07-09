# OAP Contest Manager — API server (`server/`)

The thin backend for OAP Contest Manager 2.0 (PRD: issue #13; Slice 13: issue
#26). It does exactly two things:

1. **Authentication** — passwordless only: Google OAuth and emailed magic links,
   via [Better Auth](https://better-auth.com) (a battle-tested library — auth is
   never hand-rolled). No password is ever stored or handled.
2. **Per-account contest CRUD** — stores each contest as an **opaque** versioned
   JSON envelope (`{ schemaVersion, contest }`, exactly what the client's
   `serializeContest()` produces) plus thin metadata (`name`, `updatedAt`). The
   server never parses contest internals, never generates documents, and rejects
   any payload carrying device-only credential fields.

All document generation stays in the browser. The server is a storage/auth layer
and nothing more.

## Architecture

```
src/
  env.ts           Env access (nothing throws at import; callers require values)
  db.ts            Postgres pool + our migrations (contests + events)
  contestPayload.ts  Opaque envelope validation (pure, fully tested)
  contestRepo.ts   Data access — every query scoped by ownerId
  eventLog.ts      Append-only activity log (recordEvent / queryEvents / countEvents)
  userDirectory.ts Read-only account directory over Better Auth's tables (admin)
  contestRoutes.ts Express CRUD router; auth injected as resolveUser(req)
  adminRoutes.ts   Admin API (stats/users/feed/drill-down); 404-gated by ADMIN_EMAILS
  app.ts           App factory (DI: repo + eventLog + userDirectory + resolveUser + auth mount)
  auth.ts          Better Auth instance (Google + magic link + MailerSend)
  email.ts         MailerSend magic-link sender (logs link in dev if no API key)
  server.ts        Production entrypoint — wires real Postgres + Better Auth
db/
  contests.sql     Per-account contest storage (Better Auth owns its own tables)
  events.sql       Append-only activity log
test/
  contestPayload.test.ts  Opaque-validation unit tests
  contestCrud.test.ts     Auth-gated CRUD integration tests (pg-mem + supertest)
  eventLog.test.ts        Activity-log integration tests (pg-mem + supertest)
  adminApi.test.ts        Admin gate + stats/users/feed/drill-down integration tests
```

The app factory is dependency-injected so the integration tests run the real
routing/validation/ownership logic against an in-memory Postgres with a fake
session resolver — no real database, Google, or email needed. The real
Postgres + Better Auth session are only wired in `server.ts`, and the actual
OAuth/magic-link flow is verified manually on the deploy.

## Local development

```
cp .env.example .env      # fill in DATABASE_URL; the rest can stay as-is
npm install
npm run migrate:auth      # creates Better Auth tables (needs a live Postgres)
npm run dev               # tsx watch, listens on PORT (default 8080)
npm test                  # vitest — the integration suite, no DB needed
npm run build             # typecheck (tsc --noEmit)
```

With `MAILERSEND_API_KEY` unset, magic-link emails are **logged to the console**
instead of sent, so you can test sign-in locally with no email provider. Google
sign-in needs real `GOOGLE_CLIENT_ID`/`SECRET` even locally.

---

# Deployment & setup — the human-in-the-loop steps (Allen)

These require accounts, secrets, and cloud consoles. Do them in this order; each
section says which environment variables it produces. **Never commit secrets** —
they go in the Railway service's *Variables* tab (or local `.env`, which is
gitignored).

## 1. Railway — three services + Postgres + backups

Create one Railway **project** with three services from this repo:

**a) Postgres**
1. In the project, *New → Database → Add PostgreSQL*.
2. This exposes a `DATABASE_URL` reference variable used below.
3. **Enable backups:** open the Postgres service → *Settings → Backups* → enable
   scheduled backups. (This satisfies the "database backups enabled" AC.)

**b) API service** (this `server/` directory)
1. *New → GitHub Repo* → select this repo. Set the service **Root Directory** to
   `server`. (Railway reads `server/railway.json`; build = Nixpacks, start =
   `npm run migrate:auth && npm start`.)
2. Set these variables:
   - `DATABASE_URL = ${{ Postgres.DATABASE_URL }}` (reference the Postgres service)
   - `NODE_ENV = production`
   - `SERVER_URL` = the **public single origin** `https://oapmanager.allenotto.com`
     (see 1d) — NOT this service's own Railway URL. Magic links and OAuth
     callbacks are built from it, so it must be the origin the browser uses.
   - `WEB_ORIGIN` = the same `https://oapmanager.allenotto.com` (single origin).
   - `BETTER_AUTH_SECRET` = a long random string —
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (from step 2)
   - `MAILERSEND_API_KEY`, `MAGIC_LINK_FROM_EMAIL`, `MAGIC_LINK_FROM_NAME` (from step 3)
3. Under *Settings → Networking*, generate a public domain. This API URL (e.g.
   `https://oapcmgenerator-production.up.railway.app`) is now **internal**: the
   browser never hits it directly — the frontend reverse-proxies to it. You'll
   set it as the frontend's `API_URL` in 1c, not as `SERVER_URL`. `PORT` is
   injected by Railway automatically — don't set it.

**c) Frontend service** (the `app/` host — SPA + reverse proxy)
Single-origin fix for mobile auth (#46): the frontend no longer serves static
files only. `npm start` now runs `serve.mjs`, which serves the built SPA **and**
reverse-proxies `/api/*` to the API. The browser talks to one origin, so the
session cookie is first-party (`SameSite=Lax`) and mobile sign-in works.
1. *New → GitHub Repo* → same repo, **Root Directory** `app`, **Branch**
   `claude/slice-17-parity-switchover`. Railway reads `app/railway.json`: it runs
   `npm run build` (Vite → `app/dist`) then `npm start` (`node serve.mjs`).
2. Add one variable:
   - `API_URL` = the API service's Railway URL from 1b step 3 (e.g.
     `https://oapcmgenerator-production.up.railway.app`). This is a **runtime**
     var read by `serve.mjs` — it is the proxy target, and is *not* baked into
     the browser bundle. **Do not set `VITE_API_URL`** — the app calls relative
     `/api` paths on its own origin now.

**d) Custom domain — `oapmanager.allenotto.com` (on the FRONTEND service)**
The single origin is your own subdomain, so cookies are first-party and Google
can verify the domain later. Only the frontend service gets the custom domain.
1. Frontend service → *Settings → Networking → Custom Domain* → add
   `oapmanager.allenotto.com`. Railway shows a **CNAME target** (e.g.
   `xxxx.up.railway.app`) and provisions TLS automatically.
2. In **Wix → your domain (allenotto.com) → DNS records → Add record**:
   - Type **CNAME**, Host/Name **`oapmanager`**, Value/Points to = the Railway
     CNAME target from step 1. (Same place you added the MailerSend records — this
     leaves your `www`/root Wix site untouched.)
3. Wait for Railway to show the domain **Active** (DNS propagation — minutes to a
   couple hours). Then `https://oapmanager.allenotto.com` serves the app and
   `https://oapmanager.allenotto.com/api/health` returns `{"status":"ok"}` via the
   proxy.

> Both `SERVER_URL` and `WEB_ORIGIN` on the API are the SAME value —
> `https://oapmanager.allenotto.com`. The API's own Railway URL is used only as
> the frontend's `API_URL` (the internal proxy target).

## 2. Google OAuth — consent screen + client credentials

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a
   project.
2. *APIs & Services → OAuth consent screen*: User type **External**. Fill app
   name, support email, developer contact. Add scopes `email`, `profile`,
   `openid`.
3. *Credentials → Create Credentials → OAuth client ID* → **Web application**.
   - Authorized JavaScript origin: **`https://oapmanager.allenotto.com`**.
   - Authorized redirect URI:
     **`https://oapmanager.allenotto.com/api/auth/callback/google`**
     (this is `{SERVER_URL}/api/auth/callback/google` — the single origin, which
     the frontend proxy forwards to the API).
4. Copy the **Client ID** and **Client secret** into the API service's
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. ⚠️ **Verification flag:** for THIS cycle, keep the consent screen in
   **"Testing"** and add the CMs/judges who need access as *Test users* (up to
   100). They'll see a one-time "unverified app" warning they can click through —
   fine for the dry-run and first real contest. To let **any** Texas CM sign in
   without that warning, you later *Publish* and go through **Google's OAuth
   verification**, which requires the domain (`oapmanager.allenotto.com`, now
   real) and a **privacy-policy URL** — already served at
   `https://oapmanager.allenotto.com/privacy.html`. Do that at public launch; it
   does not block our private end-to-end test.

## 3. MailerSend — magic-link email

MailerSend is used (instead of Resend) because `allenotto.com`'s DNS is on Wix,
which does not support the subdomain **MX** record Resend requires. MailerSend
verifies a domain with **TXT/CNAME** records only, which Wix supports.

1. [mailersend.com](https://mailersend.com) → sign up (new accounts go through a
   quick **approval review** before they can send — answer the use-case prompt).
2. **Domains → Add domain → `allenotto.com`.** MailerSend shows DNS records: an
   **SPF** (TXT), **DKIM** (TXT), and **Return-Path** (CNAME) — plus a
   verification TXT. Add each in **Wix → your domain → DNS records** (all
   TXT/CNAME, no MX). Wait for MailerSend to mark the domain **Verified** (DNS
   propagation — minutes to a couple hours).
3. **API tokens → Create token** → copy it. Set on the API service:
   - `MAILERSEND_API_KEY` = the token
   - `MAGIC_LINK_FROM_EMAIL` = `signin@allenotto.com`
   - `MAGIC_LINK_FROM_NAME` = `OAP Contest Manager`
   - (Remove any old `RESEND_API_KEY` / `MAGIC_LINK_FROM` variables.)
   - Until the domain is verified, you can leave `MAILERSEND_API_KEY` blank — the
     server then logs the magic link to the console (see §4) so sign-in still
     works for testing.
4. ⚠️ **School-district spam friction:** even with SPF/DKIM, district filters are
   aggressive. Expect to (a) ask a test CM to check spam/quarantine, (b) possibly
   request the sending domain be allow-listed by their IT, and (c) keep the email
   plain and link-forward (the template already is).

## 4. End-to-end verification (we do this together — the deploy-gated ACs)

Once 1–3 and 1d are done and the domain is Active, we verify — **including on a
real phone**, since fixing mobile sign-in (#46) is the whole point of this slice:

**Desktop**
- [ ] `https://oapmanager.allenotto.com` → **Continue with Google** → dashboard.
- [ ] Sign out → **email a magic link** → open the link → dashboard.
- [ ] `GET https://oapmanager.allenotto.com/api/health` → `{"status":"ok"}` (proxy works).
- [ ] `GET` the API's raw Railway URL root `/` → **302 redirects** to the app
      (not `Cannot GET /`).

**Mobile (the #46 fix — Safari on iPhone AND Chrome on Android if possible)**
- [ ] **Continue with Google** completes and lands on the dashboard (no
      `state_mismatch` / `Cannot GET /`).
- [ ] **Magic link**: request it, open the emailed link on the phone → dashboard,
      and the session **persists** after closing/reopening the tab.
- [ ] Confirm in devtools/inspector that the session cookie is `SameSite=Lax`
      (not `None`).

**Infra**
- [ ] Postgres backups show as enabled in Railway.

The auth-gated CRUD guarantees (own-contests-only, cross-account rejected,
opaque round-trip, credential/malformed rejection) are locked by the integration
suite (`npm test`). With mobile sign-in working end to end, 2.0 is ready to be
the tool of record — the switchover-sign-off AC of #30.
