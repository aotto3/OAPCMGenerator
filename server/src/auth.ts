/**
 * Better Auth instance — the whole of our authentication, none of it hand-
 * rolled. Passwordless by design: Google OAuth and emailed magic links, so the
 * server never stores or handles a password. Sessions, users, OAuth accounts,
 * and magic-link verification tokens all live in the same Railway Postgres
 * (Better Auth owns those tables; create them with `npm run migrate:auth`).
 *
 * Exported as a ready instance (not a factory) so the Better Auth CLI can
 * import it for migrations. It is only imported by the production entrypoint and
 * the CLI — never by the tests, which inject a fake auth resolver — so building
 * it here (which requires DATABASE_URL) never burdens the test run.
 */
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { getPool } from './db';
import { makeMagicLinkSender } from './email';
import { optionalEnv, requireEnv } from './env';

const magicLinkSender = makeMagicLinkSender();

const serverUrl = requireEnv('SERVER_URL');
// Frontend and API are separate origins, so the session cookie is cross-site:
// it must be SameSite=None; Secure, which requires HTTPS. We key this off the
// API's own scheme (not NODE_ENV) so a real https deploy always gets the right
// cookie regardless of how the environment is labelled; http (local dev) uses
// Lax so cookies still work same-origin.
const secureCookies = serverUrl.startsWith('https://');

export const auth = betterAuth({
  // Better Auth uses the pool directly (Kysely postgres dialect under the hood).
  database: getPool(),
  basePath: '/api/auth',
  // Public URL of THIS API service; magic links and OAuth callbacks are built
  // from it, so it must match the deployed origin exactly.
  baseURL: serverUrl,
  secret: requireEnv('BETTER_AUTH_SECRET'),
  // The browser origin allowed to drive auth (the deployed frontend).
  trustedOrigins: [requireEnv('WEB_ORIGIN')],
  socialProviders: {
    google: {
      clientId: optionalEnv('GOOGLE_CLIENT_ID'),
      clientSecret: optionalEnv('GOOGLE_CLIENT_SECRET'),
    },
  },
  plugins: [magicLink({ sendMagicLink: ({ email, url }) => magicLinkSender({ email, url }) })],
  advanced: {
    defaultCookieAttributes: secureCookies
      ? { sameSite: 'none', secure: true }
      : { sameSite: 'lax', secure: false },
  },
});
