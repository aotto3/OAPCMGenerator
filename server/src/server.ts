/**
 * Production entrypoint. Wires the real Postgres and the real Better Auth
 * session into the app factory, applies our migration, and listens. This is the
 * only file that imports both `auth` (real secrets) and the app together — the
 * boundary the tests deliberately stop short of.
 */
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { createApp } from './app';
import { auth } from './auth';
import { createContestRepo } from './contestRepo';
import { createEventLog } from './eventLog';
import { createUserDirectory } from './userDirectory';
import { getPool, migrate } from './db';
import { adminEmails, port, requireEnv } from './env';

async function main(): Promise<void> {
  const pool = getPool();
  await migrate(pool);

  const app = createApp({
    repo: createContestRepo(pool),
    eventLog: createEventLog(pool),
    userDirectory: createUserDirectory(pool),
    // The one account-acting seam: wrap Better Auth's magic-link send. Wired here
    // (the one place holding real auth); the admin routes only see the interface.
    authAdmin: {
      sendSignInLink: async (email) => {
        // Server-initiated send: the magic-link URL is built from Better Auth's
        // configured baseURL (SERVER_URL), so no request headers are needed.
        await auth.api.signInMagicLink({ body: { email }, headers: {} });
      },
    },
    adminEmails: adminEmails(),
    corsOrigin: requireEnv('WEB_ORIGIN'),
    webOrigin: requireEnv('WEB_ORIGIN'),
    // Mount Better Auth at /api/auth (before the JSON body parser — see app.ts).
    mountAuth: (a) => a.all('/api/auth/*splat', toNodeHandler(auth)),
    // A request is authenticated iff Better Auth resolves a session from its
    // cookies. Both id and email are carried through so recorded events are
    // attributable without a later join against the user table.
    resolveUser: async (req) => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) return null;
      return { id: session.user.id, email: session.user.email };
    },
  });

  const listenPort = port();
  app.listen(listenPort, () => {
    // eslint-disable-next-line no-console
    console.log(`OAP Contest Manager API listening on :${listenPort}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal: failed to start server', err);
  process.exit(1);
});
