/**
 * Judge questionnaire routes (PRD #252).
 *
 * Owner routes (signed in, 401 otherwise):
 *   GET  /link        the account's standing link token, created on first ask
 *   POST /link/reset  replaces the token; the old link stops working at once
 *   PUT  /roster      replaces the account's published judge roster
 *
 * Public route (no session):
 *   POST /public/lookup  { token, email, website } -> the judge's contests
 *
 * The public route is the only unauthenticated surface that reads account data,
 * so it gives nothing away: an unknown token, an unknown email, a filled honeypot
 * (`website`, hidden from people, filled by bots) and a malformed body all get the
 * same 404. Nothing (no judge names, no emails) is returned until an email
 * matches. Token and email travel in the body, never the URL, so they stay out of
 * access logs. Rate limits per IP and per email return 429.
 */
import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { findJudge, normalizeEmail, parseRoster } from './judgeRoster';
import type { QuestionnaireRepo } from './questionnaireRepo';
import { createRateLimiter, type RateLimiter } from './rateLimiter';
import { resolveUserOrNull, type ResolveUser } from './requestAuth';

/** Serialized roster cap; far above a real account's roster. */
export const MAX_ROSTER_BYTES = 512 * 1024;

export interface QuestionnaireLimiters {
  /** Lookups per client IP. */
  perIp: RateLimiter;
  /** Lookups per normalized email, across IPs. */
  perEmail: RateLimiter;
}

export function defaultQuestionnaireLimiters(): QuestionnaireLimiters {
  return {
    // Generous per IP: behind the proxy chain several judges may share one address.
    perIp: createRateLimiter({ limit: 60, windowMs: 10 * 60 * 1000 }),
    perEmail: createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 }),
  };
}

export interface QuestionnaireRoutesDeps {
  repo: QuestionnaireRepo;
  resolveUser: ResolveUser;
  limiters: QuestionnaireLimiters;
  /** Link token generator; defaults to 144 random bits, base64url. */
  newToken?: () => string;
}

const defaultNewToken = () => randomBytes(18).toString('base64url');

function bodyOf(req: Request): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

export function createQuestionnaireRoutes(deps: QuestionnaireRoutesDeps): Router {
  const { repo, resolveUser, limiters } = deps;
  const newToken = deps.newToken ?? defaultNewToken;
  const router = Router();

  async function requireUser(req: Request, res: Response) {
    const user = await resolveUserOrNull(req, resolveUser);
    if (!user) res.status(401).json({ error: 'Authentication required' });
    return user;
  }

  router.get('/link', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    let token = await repo.getToken(user.id);
    if (!token) {
      token = newToken();
      await repo.setToken(user.id, token, new Date().toISOString());
    }
    res.json({ token });
  });

  router.post('/link/reset', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const token = newToken();
    await repo.setToken(user.id, token, new Date().toISOString());
    res.json({ token });
  });

  router.put('/roster', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const roster = parseRoster(bodyOf(req).roster);
    if (!roster) {
      res.status(400).json({ error: 'Invalid roster' });
      return;
    }
    const text = JSON.stringify(roster);
    if (Buffer.byteLength(text, 'utf8') > MAX_ROSTER_BYTES) {
      res.status(400).json({ error: 'Roster too large' });
      return;
    }
    await repo.putRoster(user.id, text, new Date().toISOString());
    res.status(204).end();
  });

  router.post('/public/lookup', async (req, res) => {
    const notFound = () => res.status(404).json({ error: 'not_found' });
    if (!limiters.perIp.tryAcquire(req.ip ?? 'unknown')) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const { token, email, website } = bodyOf(req);
    // Honeypot: a person never sees the field; anything in it is a bot.
    if (typeof website === 'string' && website.trim() !== '') return notFound();
    if (typeof token !== 'string' || typeof email !== 'string' || token.length > 64 || email.length > 320) {
      return notFound();
    }
    const key = normalizeEmail(email);
    if (key === '') return notFound();
    if (!limiters.perEmail.tryAcquire(key)) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    const owner = await repo.ownerForToken(token);
    const stored = owner ? await repo.getRoster(owner) : undefined;
    const roster = stored ? parseRoster(JSON.parse(stored)) : null;
    const match = roster ? findJudge(roster, key) : null;
    if (!match) return notFound();
    res.json(match);
  });

  return router;
}
