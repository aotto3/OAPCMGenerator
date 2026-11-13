/**
 * Express app factory. Dependency-injected so the integration tests can build
 * the exact production app minus the two things they cannot exercise offline:
 * a real Postgres (they pass an in-memory one via `repo` and `eventLog`) and a
 * real Better Auth session (they pass a fake `resolveUser`). There is no
 * test-only branch in this file — the seams are the constructor arguments.
 */
import { timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import { createAdminRoutes } from './adminRoutes';
import { createContestRoutes } from './contestRoutes';
import type { ResolveUser } from './requestAuth';
import { createTelemetryRoutes } from './telemetryRoutes';
import {
  createQuestionnaireRoutes,
  defaultQuestionnaireLimiters,
  type QuestionnaireLimiters,
} from './questionnaireRoutes';
import type { QuestionnaireStore } from './questionnaireStore';
import { createEmailTemplateRoutes } from './emailTemplateRoutes';
import type { EmailTemplateStore } from './emailTemplateStore';
import { createQuestionnaireService } from './questionnaire';
import type { Mailer } from './mailer';
import type { ContestRepo } from './contestRepo';
import type { EventLog } from './eventLog';
import type { UserDirectory } from './userDirectory';
import type { AuthAdmin } from './authAdmin';

export interface AppDeps {
  repo: ContestRepo;
  /** Append-only activity log the contest routes write to, best-effort. */
  eventLog: EventLog;
  /** Read-only account directory (Better Auth tables) for the admin API. */
  userDirectory: UserDirectory;
  /** The one account-acting seam (resend sign-in link); tests pass a fake. */
  authAdmin: AuthAdmin;
  /** Lowercased admin email allowlist; empty means the admin API is dark. */
  adminEmails: ReadonlySet<string>;
  resolveUser: ResolveUser;
  /**
   * The clock. Every route reads time from it, never from the system clock, so
   * tests control it. Production passes `() => new Date()`.
   */
  now: () => Date;
  /** Judge questionnaire link tokens, published rosters and submissions (PRD #252). */
  questionnaireStore: QuestionnaireStore;
  /** Each account's custom email templates (PRD #320). */
  emailTemplateStore: EmailTemplateStore;
  /** The one mail sender (the questionnaire CM notice here). Tests pass a recording fake. */
  mailer: Mailer;
  /** Public questionnaire rate limits; tests pass tight ones. Defaults per questionnaireRoutes. */
  questionnaireLimiters?: QuestionnaireLimiters;
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
  /**
   * The shared secret the frontend proxy stamps on every request it forwards
   * (#261). When set, any /api/* request without it gets a flat 404, so the
   * API's public URL only answers the proxy and the forwarded IP chain can be
   * trusted. Unset (dev, tests, or mid-rollout) leaves the gate off.
   */
  proxySecret?: string;
}

/** The header the frontend proxy carries the shared secret in. Mirrored in app/serve.mjs. */
export const PROXY_SECRET_HEADER = 'x-oap-proxy-secret';

function secretMatches(given: string | undefined, secret: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind Railway's TLS-terminating edge and the frontend reverse proxy, trust
  // X-Forwarded-* so req.protocol/secure reflect the original https origin.
  //
  // Two hops (#261): the browser's request reaches us as browser -> Railway edge
  // -> frontend (serve.mjs) -> Railway edge -> API, and arrives with
  // X-Forwarded-For "<client>, <frontend egress>". With 1, req.ip was the
  // frontend's address, so every judge shared one per-IP rate limit. Measured on
  // the live chain with GET /api/admin/request-ip (2026-11-13). Safe only with
  // the proxy-secret gate on: a caller who skips the proxy could otherwise put
  // any address in that second-from-right slot.
  app.set('trust proxy', 2);

  // The proxy gate runs first, ahead of auth, so nothing under /api answers a
  // caller that skipped the frontend proxy. /health and / stay open.
  if (deps.proxySecret) {
    const secret = deps.proxySecret;
    app.use('/api', (req, res, next) => {
      if (secretMatches(req.header(PROXY_SECRET_HEADER), secret)) {
        next();
        return;
      }
      res.status(404).json({ error: 'Not found' });
    });
  }

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
    createContestRoutes({ repo: deps.repo, eventLog: deps.eventLog, resolveUser: deps.resolveUser, now: deps.now }),
  );

  app.use(
    '/api/telemetry',
    createTelemetryRoutes({ eventLog: deps.eventLog, resolveUser: deps.resolveUser, now: deps.now }),
  );

  app.use(
    '/api/questionnaire',
    createQuestionnaireRoutes({
      questionnaire: createQuestionnaireService({
        store: deps.questionnaireStore,
        mailer: deps.mailer,
        ownerEmail: async (ownerId) => (await deps.userDirectory.getUser(ownerId))?.email,
        now: deps.now,
      }),
      resolveUser: deps.resolveUser,
      limiters: deps.questionnaireLimiters ?? defaultQuestionnaireLimiters(() => deps.now().getTime()),
      eventLog: deps.eventLog,
      now: deps.now,
    }),
  );

  app.use(
    '/api/templates',
    createEmailTemplateRoutes({
      store: deps.emailTemplateStore,
      eventLog: deps.eventLog,
      resolveUser: deps.resolveUser,
      now: deps.now,
    }),
  );

  app.use(
    '/api/admin',
    createAdminRoutes({
      repo: deps.repo,
      eventLog: deps.eventLog,
      userDirectory: deps.userDirectory,
      authAdmin: deps.authAdmin,
      resolveUser: deps.resolveUser,
      adminEmails: deps.adminEmails,
      now: deps.now,
    }),
  );

  return app;
}
