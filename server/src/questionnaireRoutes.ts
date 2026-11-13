/**
 * Judge questionnaire routes (PRD #252). HTTP only: sessions, rate limits, the
 * honeypot, body-shape coercion and status mapping. The questionnaire itself
 * (tokens, roster, matching, submissions, CM notice) is `questionnaire.ts`.
 *
 * Owner routes (signed in, 401 otherwise):
 *   GET  /link         the account's standing link token, created on first ask
 *   POST /link/reset   replaces the token; the old link stops working at once
 *   PUT  /roster       replaces the account's published judge roster
 *   GET  /submissions  every judge's current answers, for the app to apply
 *
 * Public routes (no session):
 *   POST /public/link    { token } -> { active }: whether the link is current, so
 *                        the page can tell a judge an old link was replaced
 *   POST /public/lookup  { token, email, website } -> the judge's contests and
 *                        their last answers
 *   POST /public/submit  { token, email, website, answers } -> stores the answers
 *                        and emails each CM involved (best-effort)
 *
 * The public route is the only unauthenticated surface that reads account data,
 * so it gives nothing away: an unknown token, an unknown email, a filled honeypot
 * (`website`, hidden from people, filled by bots) and a malformed body all get the
 * same 404 (a honeypot submit gets a fake success and is dropped). Nothing (no
 * judge names, no emails) is returned until an email matches. The link check
 * says only whether a 144-bit token is current, which helps no one guess one. Token and email
 * travel in the body, never the URL, so they stay out of access logs. Rate limits
 * per IP and per email return 429.
 */
import { Router, type Request, type Response } from 'express';
import { normalizeEmail } from './judgeRoster';
import type { QuestionnaireService } from './questionnaire';
import { createRateLimiter, type RateLimiter } from './rateLimiter';
import { resolveUserOrNull, type AuthUser, type ResolveUser } from './requestAuth';

export interface QuestionnaireLimiters {
  /** Lookups per client IP. */
  perIp: RateLimiter;
  /** Lookups per normalized email, across IPs. */
  perEmail: RateLimiter;
}

/** The production limits, timed by the given clock (epoch ms). */
export function defaultQuestionnaireLimiters(now: () => number): QuestionnaireLimiters {
  return {
    // Generous per IP: behind the proxy chain several judges may share one address.
    perIp: createRateLimiter({ limit: 60, windowMs: 10 * 60 * 1000, now }),
    // Lookups and submits share it; a judge fixing answers a few times stays well under.
    perEmail: createRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000, now }),
  };
}

export interface QuestionnaireRoutesDeps {
  questionnaire: QuestionnaireService;
  resolveUser: ResolveUser;
  limiters: QuestionnaireLimiters;
  /** Injected clock; stamps the honeypot's fake success. */
  now: () => Date;
}

function bodyOf(req: Request): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

type Handler = (req: Request, res: Response) => Promise<void>;

/** Any unexpected error inside a handler becomes a 500, like the contest and admin routers. */
const guarded =
  (handler: Handler): Handler =>
  async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Unexpected error handling questionnaire request', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  };

export function createQuestionnaireRoutes(deps: QuestionnaireRoutesDeps): Router {
  const { questionnaire, resolveUser, limiters, now } = deps;
  const router = Router();

  /** Signed-in routes: resolves the user or answers 401. */
  const authed = (handler: (req: Request, res: Response, user: AuthUser) => Promise<void>) =>
    guarded(async (req, res) => {
      const user = await resolveUserOrNull(req, resolveUser);
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      await handler(req, res, user);
    });

  router.get(
    '/link',
    authed(async (_req, res, user) => {
      res.json(await questionnaire.linkFor(user.id));
    }),
  );

  router.post(
    '/link/reset',
    authed(async (_req, res, user) => {
      res.json(await questionnaire.resetLink(user.id));
    }),
  );

  router.put(
    '/roster',
    authed(async (req, res, user) => {
      const result = await questionnaire.publishRoster(user.id, bodyOf(req).roster);
      if ('error' in result) {
        res.status(400).json({ error: result.error === 'too_large' ? 'Roster too large' : 'Invalid roster' });
        return;
      }
      res.status(204).end();
    }),
  );

  router.get(
    '/submissions',
    authed(async (_req, res, user) => {
      res.json({ submissions: await questionnaire.submissionsFor(user.id) });
    }),
  );

  const notFound = (res: Response) => void res.status(404).json({ error: 'not_found' });

  /**
   * The shared public preamble: per-IP limit, honeypot, body shape, per-email
   * limit. Answers the request itself (and returns null) unless the request may
   * go on to the service, in which case it returns the token and email.
   */
  function admit(req: Request, res: Response, onHoneypot: () => void): { token: string; email: string } | null {
    if (!limiters.perIp.tryAcquire(req.ip ?? 'unknown')) {
      res.status(429).json({ error: 'rate_limited' });
      return null;
    }
    const { token, email, website } = bodyOf(req);
    // Honeypot: a person never sees the field; anything in it is a bot.
    if (typeof website === 'string' && website.trim() !== '') {
      onHoneypot();
      return null;
    }
    if (typeof token !== 'string' || typeof email !== 'string' || token.length > 64 || email.length > 320) {
      notFound(res);
      return null;
    }
    const key = normalizeEmail(email);
    if (key === '') {
      notFound(res);
      return null;
    }
    if (!limiters.perEmail.tryAcquire(key)) {
      res.status(429).json({ error: 'rate_limited' });
      return null;
    }
    return { token, email: key };
  }

  router.post(
    '/public/link',
    guarded(async (req, res) => {
      if (!limiters.perIp.tryAcquire(req.ip ?? 'unknown')) {
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
      const { token } = bodyOf(req);
      const active = typeof token === 'string' && token.length <= 64 && (await questionnaire.linkActive(token));
      res.json({ active });
    }),
  );

  router.post(
    '/public/lookup',
    guarded(async (req, res) => {
      const ok = admit(req, res, () => notFound(res));
      if (!ok) return;
      const found = await questionnaire.lookup(ok.token, ok.email);
      if (!found) {
        notFound(res);
        return;
      }
      res.json(found);
    }),
  );

  router.post(
    '/public/submit',
    guarded(async (req, res) => {
      // A bot that fills the honeypot is told it succeeded and nothing is stored.
      const ok = admit(req, res, () => void res.json({ submittedAt: now().toISOString() }));
      if (!ok) return;
      const result = await questionnaire.submit(ok.token, ok.email, bodyOf(req).answers);
      if ('error' in result) {
        if (result.error === 'not_found') notFound(res);
        else res.status(400).json({ error: 'invalid_answers' });
        return;
      }
      res.json(result);
    }),
  );

  return router;
}
