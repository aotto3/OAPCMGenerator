/**
 * Custom email template routes (PRD #320). Signed in (401 otherwise), and every
 * call acts only on the caller's own templates.
 *
 *   GET  /   the caller's templates, oldest first: { templates }
 *   POST /   { name, subject, body } -> 201 { template }, or 400 { error } where
 *            error is a TemplateProblem or 'invalid_body'
 *
 * Each write appends an activity event carrying the template name only, never
 * its subject or body, best-effort: a logging failure never fails the request.
 */
import { Router, type Request, type Response } from 'express';
import { parseTemplateInput } from './emailTemplateRules';
import type { EmailTemplateStore } from './emailTemplateStore';
import type { EventLog } from './eventLog';
import { TEMPLATE_EVENTS } from './eventTypes';
import { resolveUserOrNull, type AuthUser, type ResolveUser } from './requestAuth';

export interface EmailTemplateRoutesDeps {
  store: EmailTemplateStore;
  eventLog: EventLog;
  resolveUser: ResolveUser;
  now: () => Date;
}

type Handler = (req: Request, res: Response, user: AuthUser) => Promise<void>;

export function createEmailTemplateRoutes(deps: EmailTemplateRoutesDeps): Router {
  const { store, eventLog, resolveUser, now } = deps;
  const router = Router();

  /** Resolves the caller (401 otherwise) and turns an unexpected error into a 500. */
  const authed = (handler: Handler) => async (req: Request, res: Response) => {
    try {
      const user = await resolveUserOrNull(req, resolveUser);
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      await handler(req, res, user);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Unexpected error handling email template request', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  };

  async function record(user: AuthUser, type: string, templateName: string): Promise<void> {
    try {
      await eventLog.recordEvent({
        occurredAt: now().toISOString(),
        userId: user.id,
        userEmail: user.email,
        type,
        detail: { templateName },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to record email template event (ignored)', err);
    }
  }

  router.get(
    '/',
    authed(async (_req, res, user) => {
      res.json({ templates: await store.list(user.id) });
    }),
  );

  router.post(
    '/',
    authed(async (req, res, user) => {
      const input = parseTemplateInput(req.body);
      if (!input) {
        res.status(400).json({ error: 'invalid_body' });
        return;
      }
      const result = await store.create(user.id, input, now().toISOString());
      if (result.kind === 'invalid') {
        res.status(400).json({ error: result.problem });
        return;
      }
      await record(user, TEMPLATE_EVENTS.created, result.template.name);
      res.status(201).json({ template: result.template });
    }),
  );

  return router;
}
