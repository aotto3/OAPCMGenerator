/**
 * Express app factory. Dependency-injected so the integration tests can build
 * the exact production app minus the two things they cannot exercise offline:
 * a real Postgres (they pass an in-memory one via `repo` and `eventLog`) and a
 * real Better Auth session (they pass a fake `resolveUser`). There is no
 * test-only branch in this file — the seams are the constructor arguments.
 */
import cors from 'cors';
import express, { type Express } from 'express';
import { createAdminRoutes } from './adminRoutes';
import { createContestRoutes, type ResolveUser } from './contestRoutes';
import type { ContestRepo } from './contestRepo';
import type { EventLog } from './eventLog';
import type { UserDirectory } from './userDirectory';

export interface AppDeps {
  repo: ContestRepo;
  /** Append-only activity log the contest routes write to, best-effort. */
  eventLog: EventLog;
  /** Read-only account directory (Better Auth tables) for the admin API. */
  userDirectory: UserDirectory;
  /** Lowercased admin email allowlist; empty means the admin API is dark. */
  adminEmails: ReadonlySet<string>;
  resolveUser: ResolveUser;
  /** Allowed browser origin for CORS (the deployed frontend). Omitted in tests. */
  corsOrigin?: string;
  /**
   * Frontend origin to bounce the API root (GET /) to. The API has no browser UI
   * of its own, so a stray hit on the root — or Better Auth falling back to its
   * baseURL on an auth error — should land the user in the app instead of
   * Express's default "Cannot GET /". Omitted in tests. (Slice 17, #46)
   */
  webOrigin?: string;
  /**
   * Mounts the auth handler. Called BEFORE the JSON body parser because Better
   * Auth reads the raw request body itself. Omitted in tests (no real auth).
   */
  mountAuth?: (app: Express) => void;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind Railway's TLS-terminating edge and the frontend reverse proxy, trust
  // X-Forwarded-* so req.protocol/secure reflect the original https origin.
  app.set('trust proxy', 1);

  if (deps.corsOrigin) {
    app.use(cors({ origin: deps.corsOrigin, credentials: true }));
  }

  // Auth routes must see the raw body — mount them before express.json().
  deps.mountAuth?.(app);

  app.use(express.json({ limit: '4mb' }));

  // Send anyone who lands on the bare API root back to the app (see webOrigin).
  if (deps.webOrigin) {
    const webOrigin = deps.webOrigin;
    app.get('/', (_req, res) => {
      res.redirect(302, webOrigin);
    });
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    '/api/contests',
    createContestRoutes({ repo: deps.repo, eventLog: deps.eventLog, resolveUser: deps.resolveUser }),
  );

  app.use(
    '/api/admin',
    createAdminRoutes({
      repo: deps.repo,
      eventLog: deps.eventLog,
      userDirectory: deps.userDirectory,
      resolveUser: deps.resolveUser,
      adminEmails: deps.adminEmails,
    }),
  );

  return app;
}
