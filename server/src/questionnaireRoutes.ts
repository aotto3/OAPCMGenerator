/**
 * Judge questionnaire routes (PRD #252).
 *
 * Owner routes (signed in, 401 otherwise):
 *   GET  /link        the account's standing link token, created on first ask
 *   POST /link/reset  replaces the token; the old link stops working at once
 *   PUT  /roster      replaces the account's published judge roster
 *
 *   GET  /submissions  every judge's current answers, for the app to apply
 *
 * Public routes (no session):
 *   POST /public/lookup  { token, email, website } -> the judge's contests and
 *                        their last answers
 *   POST /public/submit  { token, email, website, answers } -> stores the answers
 *                        and emails each CM involved (best-effort)
 *
 * The public route is the only unauthenticated surface that reads account data,
 * so it gives nothing away: an unknown token, an unknown email, a filled honeypot
 * (`website`, hidden from people, filled by bots) and a malformed body all get the
 * same 404 (a honeypot submit gets a fake success and is dropped). Nothing (no
 * judge names, no emails) is returned until an email matches. Token and email travel in the body, never the URL, so they stay out of
 * access logs. Rate limits per IP and per email return 429.
 */
import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { findJudge, normalizeEmail, parseAnswers, parseRoster, type JudgeLookup } from './judgeRoster';
import type { QuestionnaireRepo } from './questionnaireRepo';
import { buildSubmissionNotices } from './questionnaireEmail';
import type { Mailer } from './mailer';
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
  repo: QuestionnaireRepo;
  resolveUser: ResolveUser;
  limiters: QuestionnaireLimiters;
  /** Sends the CM notice on submit. A failure is logged, never surfaced to the judge. */
  mailer: Mailer;
  /** The account's sign-in email: the notice's fallback recipient. */
  ownerEmail: (ownerId: string) => Promise<string | undefined>;
  /** Injected clock; every timestamp this router stamps or compares comes from it. */
  now: () => Date;
  /** Link token generator; defaults to 144 random bits, base64url. */
  newToken?: () => string;
}

const defaultNewToken = () => randomBytes(18).toString('base64url');

function bodyOf(req: Request): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

export function createQuestionnaireRoutes(deps: QuestionnaireRoutesDeps): Router {
  const { repo, resolveUser, limiters, now } = deps;
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
      await repo.setToken(user.id, token, now().toISOString());
    }
    res.json({ token });
  });

  router.post('/link/reset', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const token = newToken();
    await repo.setToken(user.id, token, now().toISOString());
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
    await repo.putRoster(user.id, text, now().toISOString());
    res.status(204).end();
  });

  router.get('/submissions', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const rows = await repo.listSubmissions(user.id);
    res.json({
      submissions: rows.map((r) => ({ email: r.email, submittedAt: r.submittedAt, answers: JSON.parse(r.answers) })),
    });
  });

  /**
   * The shared public preamble: rate limits, honeypot, and the token + email
   * match. Answers the request itself (and returns null) on anything but a match.
   */
  async function matchJudge(
    req: Request,
    res: Response,
    onHoneypot: () => void,
  ): Promise<{ owner: string; email: string; judge: JudgeLookup } | null> {
    const notFound = () => void res.status(404).json({ error: 'not_found' });
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
      notFound();
      return null;
    }
    const key = normalizeEmail(email);
    if (key === '') {
      notFound();
      return null;
    }
    if (!limiters.perEmail.tryAcquire(key)) {
      res.status(429).json({ error: 'rate_limited' });
      return null;
    }
    const owner = await repo.ownerForToken(token);
    const stored = owner ? await repo.getRoster(owner) : undefined;
    const roster = stored ? parseRoster(JSON.parse(stored)) : null;
    const judge = roster ? findJudge(roster, key) : null;
    if (!owner || !judge) {
      notFound();
      return null;
    }
    return { owner, email: key, judge };
  }

  /** Emails each CM involved. Best-effort: a mail failure never fails the submit. */
  async function notifyCms(
    match: { owner: string; email: string; judge: JudgeLookup },
    answers: NonNullable<ReturnType<typeof parseAnswers>>,
    isUpdate: boolean,
  ): Promise<void> {
    try {
      const fallbackEmail = await deps.ownerEmail(match.owner).catch(() => undefined);
      const mails = buildSubmissionNotices({
        judgeName: match.judge.judgeName,
        judgeEmail: match.email,
        contests: match.judge.contests,
        answers,
        isUpdate,
        fallbackEmail,
      });
      for (const mail of mails) {
        try {
          await deps.mailer.send(mail);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('Questionnaire notice failed to send (ignored)', err);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Questionnaire notice failed (ignored)', err);
    }
  }

  router.post('/public/lookup', async (req, res) => {
    const match = await matchJudge(req, res, () => void res.status(404).json({ error: 'not_found' }));
    if (!match) return;
    const last = await repo.getSubmission(match.owner, match.email);
    res.json({ ...match.judge, lastSubmission: last ? JSON.parse(last.answers) : null });
  });

  router.post('/public/submit', async (req, res) => {
    // A bot that fills the honeypot is told it succeeded and nothing is stored.
    const match = await matchJudge(req, res, () => void res.json({ submittedAt: now().toISOString() }));
    if (!match) return;
    const answers = parseAnswers(
      bodyOf(req).answers,
      match.judge.contests.map((c) => c.id),
    );
    if (!answers) {
      res.status(400).json({ error: 'invalid_answers' });
      return;
    }
    const previous = await repo.getSubmission(match.owner, match.email);
    const submittedAt = now().toISOString();
    await repo.putSubmission(match.owner, match.email, submittedAt, JSON.stringify(answers));
    await notifyCms(match, answers, previous !== undefined);
    res.json({ submittedAt });
  });

  return router;
}
