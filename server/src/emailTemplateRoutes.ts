/**
 * Custom email template routes (PRD #320). Signed in (401 otherwise).
 *
 * The caller's own templates:
 *   GET  /              the caller's templates, oldest first: { templates }
 *   POST /              { name, subject, body } -> 201 { template }, or 400
 *                       { error } where error is a TemplateProblem or 'invalid_body'
 *   PUT  /:id           { name, subject, body, authorName? } -> 200 { template }
 *                       (replaces it, last write wins; a shared template's
 *                       author name is refreshed when authorName is given),
 *                       400 { error } as for POST, or 404
 *   DELETE /:id         -> 204, or 404
 *   POST /:id/share     { authorName } -> 200 { template }; 400
 *                       { error: 'author_name_required' } for a blank or too-long
 *                       name; 404
 *   DELETE /:id/share   -> 200 { template } (back to private), or 404
 *
 * The gallery (any signed-in CM, slice #325):
 *   GET  /gallery            every shared template as a card: { templates } with
 *                            id, name, subject, body, authorName, sharedAt and
 *                            mine (whether the caller wrote it). Never an owner
 *                            id or email.
 *   POST /gallery/:id/add    { name? } -> 201 { template }: an independent private
 *                            copy in the caller's account; 400 { error } under
 *                            the usual rules; 404 when the source is not shared
 *
 * An id that is not one of the caller's templates is a 404, whoever owns it.
 *
 * Each write appends an activity event carrying the template name only, never
 * its subject or body, best-effort: a logging failure never fails the request.
 */
import { Router, type Request, type Response } from 'express';
import { cleanAuthorName, parseTemplateInput } from './emailTemplateRules';
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

function bodyOf(req: Request): Record<string, unknown> {
  return typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
}

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

  const notFound = (res: Response) => res.status(404).json({ error: 'Not found' });

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

  // Registered before the '/:id' routes so 'gallery' is never read as an id.
  router.get(
    '/gallery',
    authed(async (_req, res, user) => {
      res.json({ templates: await store.listShared(user.id) });
    }),
  );

  router.post(
    '/gallery/:id/add',
    authed(async (req, res, user) => {
      const { name } = bodyOf(req);
      if (name !== undefined && typeof name !== 'string') {
        res.status(400).json({ error: 'invalid_body' });
        return;
      }
      const result = await store.addFromGallery(user.id, String(req.params.id), name, now().toISOString());
      if (result.kind === 'not_found') {
        notFound(res);
        return;
      }
      if (result.kind === 'invalid') {
        res.status(400).json({ error: result.problem });
        return;
      }
      await record(user, TEMPLATE_EVENTS.addedFromGallery, result.template.name);
      res.status(201).json({ template: result.template });
    }),
  );

  router.put(
    '/:id',
    authed(async (req, res, user) => {
      const input = parseTemplateInput(req.body);
      if (!input) {
        res.status(400).json({ error: 'invalid_body' });
        return;
      }
      const authorName = cleanAuthorName(bodyOf(req).authorName) ?? undefined;
      const result = await store.update(user.id, String(req.params.id), input, now().toISOString(), authorName);
      if (result.kind === 'not_found') {
        notFound(res);
        return;
      }
      if (result.kind === 'invalid') {
        res.status(400).json({ error: result.problem });
        return;
      }
      await record(user, TEMPLATE_EVENTS.updated, result.template.name);
      res.json({ template: result.template });
    }),
  );

  router.delete(
    '/:id',
    authed(async (req, res, user) => {
      const result = await store.remove(user.id, String(req.params.id));
      if (result.kind === 'not_found') {
        notFound(res);
        return;
      }
      await record(user, TEMPLATE_EVENTS.deleted, result.template.name);
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/share',
    authed(async (req, res, user) => {
      const authorName = cleanAuthorName(bodyOf(req).authorName);
      if (!authorName) {
        res.status(400).json({ error: 'author_name_required' });
        return;
      }
      const result = await store.share(user.id, String(req.params.id), authorName, now().toISOString());
      if (result.kind === 'not_found') {
        notFound(res);
        return;
      }
      await record(user, TEMPLATE_EVENTS.shared, result.template.name);
      res.json({ template: result.template });
    }),
  );

  router.delete(
    '/:id/share',
    authed(async (req, res, user) => {
      const result = await store.unshare(user.id, String(req.params.id));
      if (result.kind === 'not_found') {
        notFound(res);
        return;
      }
      await record(user, TEMPLATE_EVENTS.unshared, result.template.name);
      res.json({ template: result.template });
    }),
  );

  return router;
}
