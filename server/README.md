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
  db.ts            Postgres pool + our contests migration
  contestPayload.ts  Opaque envelope validation (pure, fully tested)
  contestRepo.ts   Data access — every query scoped by ownerId
  contestRoutes.ts Express CRUD router; auth injected as resolveUserId(req)
  app.ts           App factory (DI: repo + resolveUserId + optional auth mount)
  auth.ts          Better Auth instance (Google + magic link + Resend)
  email.ts         Resend magic-link sender (logs link in dev if no API key)
  server.ts        Production entrypoint — wires real Postgres + Better Auth
db/
  contests.sql     Our one table (Better Auth owns its own tables)
test/
  contestPayload.test.ts  Opaque-validation unit tests
  contestCrud.test.ts     Auth-gated CRUD integration tests (pg-mem + supertest)
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

With `RESEND_API_KEY` unset, magic-link emails are **logged to the console**
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
   - `SERVER_URL` = the API service's public URL (see below)
   - `WEB_ORIGIN` = the frontend's public URL (see 1c)
   - `BETTER_AUTH_SECRET` = a long random string —
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (from step 2)
   - `RESEND_API_KEY`, `MAGIC_LINK_FROM` (from step 3)
3. Under *Settings → Networking*, generate a public domain. Set `SERVER_URL` to
   exactly that origin (e.g. `https://oap-api.up.railway.app`), **no trailing
   slash**. `PORT` is injected by Railway automatically — don't set it.

**c) Frontend service** (the `app/` static build)
1. *New → GitHub Repo* → same repo, **Root Directory** `app`, **Branch**
   `claude/slice-13-server-auth`. Railway reads `app/railway.json` and handles
   build + serve automatically: it runs `npm run build` (Vite → `app/dist`) and
   then `npm start` (serves `dist` as a single-page app on Railway's `PORT`).
   You do not configure any build or start command by hand.
2. Add one variable:
   - `VITE_API_URL` = the API `SERVER_URL` from 1b. This is baked into the
     bundle at **build** time, so if it ever changes you must redeploy the
     frontend for the new value to take effect.
3. Under *Settings → Networking*, generate a public domain, then set the **API**
   service's `WEB_ORIGIN` to exactly that frontend origin (with `https://`, no
   trailing slash).

> `SERVER_URL` (API) and `WEB_ORIGIN` (frontend) reference each other, so you'll
> set placeholder values, generate both domains, then update both. After
> changing `VITE_API_URL`, redeploy the frontend so the new value is baked in.

## 2. Google OAuth — consent screen + client credentials

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a
   project.
2. *APIs & Services → OAuth consent screen*: User type **External**. Fill app
   name, support email, developer contact. Add scopes `email`, `profile`,
   `openid`.
3. *Credentials → Create Credentials → OAuth client ID* → **Web application**.
   - Authorized JavaScript origins: your frontend `WEB_ORIGIN`.
   - Authorized redirect URI: **`{SERVER_URL}/api/auth/callback/google`**
     (e.g. `https://oap-api.up.railway.app/api/auth/callback/google`).
4. Copy the **Client ID** and **Client secret** into the API service's
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. ⚠️ **Verification flag:** while the consent screen is in "Testing", only email
   addresses you add as *Test users* can sign in, and there's an "unverified app"
   warning. To let **any** Texas CM sign in, you must *Publish* the app and go
   through **Google's OAuth verification** (can take days–weeks; may require a
   privacy-policy URL and a domain-ownership check). Plan for this before public
   launch — it does not block our private end-to-end test with your own account.

## 3. Resend — magic-link email

1. [resend.com](https://resend.com) → create an account and an **API key** →
   set `RESEND_API_KEY` on the API service.
2. **Verify a sending domain** (*Domains → Add Domain*) and add the SPF, DKIM,
   and DMARC DNS records Resend gives you. Set `MAGIC_LINK_FROM` to an address on
   that domain, e.g. `OAP Contest Manager <signin@yourdomain.org>`.
   - The unverified `onboarding@resend.dev` sender works for a quick test but
     **will** hit spam filters — do not rely on it for real CMs.
3. ⚠️ **School-district spam friction:** even with SPF/DKIM/DMARC, district
   filters are aggressive. Expect to (a) ask a test CM to check spam/quarantine,
   (b) possibly request the sending domain be allow-listed by their IT, and
   (c) keep the email plain and link-forward (the template already is).

## 4. End-to-end verification (we do this together — the deploy-gated ACs)

Once 1–3 are done and both services are deployed, we verify with your account:

- [ ] Open the frontend URL → **Continue with Google** → land on the dashboard.
- [ ] Sign out → **email a magic link** → open the link → land on the dashboard.
- [ ] The API is reachable at its stable URL (`GET {SERVER_URL}/health` → `{"status":"ok"}`).
- [ ] Postgres backups show as enabled in Railway.

The auth-gated CRUD guarantees (own-contests-only, cross-account rejected,
opaque round-trip, credential/malformed rejection) are already locked by the
integration suite (`npm test`) and don't need manual checking. Wiring the
frontend's contests to this API is the **next** slice (#27, background sync);
this slice deliberately stops at "signed in, reaching the app."
