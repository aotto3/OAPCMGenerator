/**
 * Per-account contest CRUD. Auth is injected as `resolveUser(req)` (yielding the
 * caller's id + email) so this router carries no auth machinery of its own —
 * production wires it to Better Auth's session lookup, the integration tests
 * wire it to a fake. Every handler refuses unauthenticated requests (401) and
 * scopes all data access to the caller's id, so a contest owned by someone else
 * is indistinguishable from one that does not exist (404, never a 403 that would
 * leak its existence).
 *
 * Each write (create / save / delete) appends one activity-log event via the
 * injected `eventLog`, best-effort: recording is wrapped so a log failure never
 * fails or delays the user's request. Delete captures the contest name before
 * removing the row so the event outlives it.
 *
 * Request bodies carry opaque `payload` plus thin client-supplied metadata
 * (id, name, updatedAt). The server validates the envelope shape and stores the
 * payload verbatim; it never derives metadata from the payload, which would
 * mean interpreting contest internals.
 */
import { Router, type Request, type Response } from 'express';
import type { ContestRepo } from './contestRepo';
import type { EventInput, EventLog } from './eventLog';
import { PayloadError, validatePayload } from './contestPayload';

/** The authenticated caller. Email is denormalized into the events it produces. */
export interface AuthUser {
  id: string;
  email: string;
}

/** Resolves the authenticated user from a request, or null if none. */
export type ResolveUser = (req: Request) => Promise<AuthUser | null> | AuthUser | null;

export interface ContestRoutesDeps {
  repo: ContestRepo;
  resolveUser: ResolveUser;
  eventLog: EventLog;
}

/** Event types this router appends. Dotted names leave room for future actions. */
const EVENT = {
  created: 'contest.created',
  updated: 'contest.updated',
  deleted: 'contest.deleted',
} as const;

interface ContestBody {
  name: string;
  updatedAt: string;
  payload: string;
}

/** Validates the metadata + opaque payload of a write body. */
function readBody(body: unknown, expectedId: string): ContestBody {
  if (typeof body !== 'object' || body === null) {
    throw new PayloadError('request body must be a JSON object');
  }
  const { name, updatedAt, payload } = body as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new PayloadError('name is required');
  }
  if (typeof updatedAt !== 'string' || updatedAt.trim() === '') {
    throw new PayloadError('updatedAt is required');
  }
  const envelope = validatePayload(payload);
  // The payload's own contest id, when present, must match the resource id, so
  // a record can never be stored under a key that disagrees with its contents.
  if (envelope.contestId !== undefined && envelope.contestId !== expectedId) {
    throw new PayloadError('payload contest id does not match the contest id');
  }
  return { name, updatedAt, payload: payload as string };
}

export function createContestRoutes(deps: ContestRoutesDeps): Router {
  const { repo, resolveUser, eventLog } = deps;
  const router = Router();

  /**
   * Appends an activity-log event, best-effort: the log is a side record, so a
   * write failure here must never fail or delay the user's contest request. Any
   * error is swallowed (and logged for operators), never propagated to the
   * handler.
   */
  const recordEvent = async (event: EventInput): Promise<void> => {
    try {
      await eventLog.recordEvent(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to record contest event (ignored)', err);
    }
  };

  /** Wraps a handler with auth: resolves the user or answers 401. */
  const authed =
    (handler: (req: Request, res: Response, user: AuthUser) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      let user: AuthUser | null;
      try {
        user = await resolveUser(req);
      } catch {
        user = null;
      }
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      try {
        await handler(req, res, user);
      } catch (err) {
        if (err instanceof PayloadError) {
          res.status(400).json({ error: err.message });
          return;
        }
        // eslint-disable-next-line no-console
        console.error('Unexpected error handling contest request', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    };

  // List the caller's contests (metadata only — no payloads).
  router.get(
    '/',
    authed(async (_req, res, user) => {
      res.json({ contests: await repo.listByOwner(user.id) });
    }),
  );

  // Fetch one owned contest with its opaque payload.
  router.get(
    '/:id',
    authed(async (req, res, user) => {
      const record = await repo.getOwned(user.id, String(req.params.id));
      if (!record) {
        res.status(404).json({ error: 'Contest not found' });
        return;
      }
      res.json(record);
    }),
  );

  // Create a new contest. 409 if the id is already taken (globally unique key).
  router.post(
    '/',
    authed(async (req, res, user) => {
      const body = req.body as Record<string, unknown>;
      const id = body?.id;
      if (typeof id !== 'string' || id.trim() === '') {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      const { name, updatedAt, payload } = readBody(body, id);
      if (await repo.exists(id)) {
        res.status(409).json({ error: 'A contest with this id already exists' });
        return;
      }
      const now = new Date().toISOString();
      await repo.insert({ id, ownerId: user.id, name, updatedAt, payload, createdAt: now });
      await recordEvent({
        occurredAt: now,
        userId: user.id,
        userEmail: user.email,
        type: EVENT.created,
        contestId: id,
        contestName: name,
      });
      res.status(201).json({ id, name, updatedAt });
    }),
  );

  // Replace an owned contest. 404 if it is missing or owned by someone else.
  router.put(
    '/:id',
    authed(async (req, res, user) => {
      const id = String(req.params.id);
      const { name, updatedAt, payload } = readBody(req.body, id);
      const updated = await repo.update(user.id, id, { name, updatedAt, payload });
      if (!updated) {
        res.status(404).json({ error: 'Contest not found' });
        return;
      }
      await recordEvent({
        occurredAt: new Date().toISOString(),
        userId: user.id,
        userEmail: user.email,
        type: EVENT.updated,
        contestId: id,
        contestName: name,
      });
      res.json({ id, name, updatedAt });
    }),
  );

  // Delete an owned contest. 404 if it is missing or owned by someone else.
  router.delete(
    '/:id',
    authed(async (req, res, user) => {
      const id = String(req.params.id);
      // Read the row first so the delete event can retain the contest name after
      // the row is gone; a missing row is the 404 (nothing to delete or log).
      const existing = await repo.getOwned(user.id, id);
      if (!existing) {
        res.status(404).json({ error: 'Contest not found' });
        return;
      }
      await repo.remove(user.id, id);
      await recordEvent({
        occurredAt: new Date().toISOString(),
        userId: user.id,
        userEmail: user.email,
        type: EVENT.deleted,
        contestId: id,
        contestName: existing.name,
      });
      res.status(204).end();
    }),
  );

  return router;
}
