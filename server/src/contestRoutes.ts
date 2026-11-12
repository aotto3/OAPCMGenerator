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
 * Delete tombstones (RFC #276, slice #280) make deletes durable across devices:
 * newer action wins, ties go to the delete. `DELETE ?deletedAt=<ISO>` refuses
 * with 409 `{ updatedAt }` when the row was edited later, else removes the row
 * and records an owner-scoped tombstone (204, also when the row was already
 * gone). A PUT/POST stamped at or before a tombstone is refused with 410
 * `{ deletedAt }`; a newer one clears it. `GET /` lists the tombstones beside
 * the contests. All of it is additive: a client that never sends `deletedAt`
 * sees today's behavior, apart from the extra `tombstones` field in the list.
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
import { CONTEST_EVENTS } from './eventTypes';
import { resolveUserOrNull, type AuthUser, type ResolveUser } from './requestAuth';

export interface ContestRoutesDeps {
  repo: ContestRepo;
  resolveUser: ResolveUser;
  eventLog: EventLog;
  /** Injected clock; every timestamp this router stamps or compares comes from it. */
  now: () => Date;
}

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

/** An ISO 8601 date-time with a zone, e.g. 2026-09-01T12:00:00.000Z. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Reads the optional `deletedAt` query parameter: undefined when absent,
 * normalized to toISOString form when valid, PayloadError (400) otherwise.
 */
function readDeletedAt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new PayloadError('deletedAt must be an ISO 8601 timestamp');
  }
  return new Date(value).toISOString();
}

/** True when a write stamped `updatedAt` is strictly newer than a delete at `deletedAt`. */
const writeBeatsDelete = (updatedAt: string, deletedAt: string): boolean =>
  Date.parse(updatedAt) > Date.parse(deletedAt);

export function createContestRoutes(deps: ContestRoutesDeps): Router {
  const { repo, resolveUser, eventLog, now: clock } = deps;
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

  /**
   * The tombstone gate for a write: answers 410 `{ deletedAt }` and returns
   * null when the owner deleted this contest at or after `updatedAt` (ties go
   * to the delete). Otherwise returns whether a stale tombstone exists, for the
   * handler to clear once its write lands.
   */
  const tombstoneGate = async (
    res: Response,
    ownerId: string,
    id: string,
    updatedAt: string,
  ): Promise<{ stale: boolean } | null> => {
    const deletedAt = await repo.getTombstone(ownerId, id);
    if (deletedAt === undefined) return { stale: false };
    if (!writeBeatsDelete(updatedAt, deletedAt)) {
      res.status(410).json({ error: 'Contest was deleted', deletedAt });
      return null;
    }
    return { stale: true };
  };

  /** Wraps a handler with auth: resolves the user or answers 401. */
  const authed =
    (handler: (req: Request, res: Response, user: AuthUser) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      const user = await resolveUserOrNull(req, resolveUser);
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
      const [contests, tombstones] = await Promise.all([
        repo.listByOwner(user.id),
        repo.listTombstones(user.id),
      ]);
      res.json({ contests, tombstones });
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

  // Create a new contest. 410 if the owner deleted it at or after this version;
  // 409 if the id is already taken (globally unique key).
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
      const gate = await tombstoneGate(res, user.id, id, updatedAt);
      if (!gate) return;
      if (await repo.exists(id)) {
        res.status(409).json({ error: 'A contest with this id already exists' });
        return;
      }
      const now = clock().toISOString();
      await repo.insert({ id, ownerId: user.id, name, updatedAt, payload, createdAt: now });
      if (gate.stale) await repo.clearTombstone(user.id, id);
      await recordEvent({
        occurredAt: now,
        userId: user.id,
        userEmail: user.email,
        type: CONTEST_EVENTS.created,
        contestId: id,
        contestName: name,
      });
      res.status(201).json({ id, name, updatedAt });
    }),
  );

  // Replace an owned contest. 410 if the owner deleted it at or after this
  // version; 404 if it is missing or owned by someone else.
  router.put(
    '/:id',
    authed(async (req, res, user) => {
      const id = String(req.params.id);
      const { name, updatedAt, payload } = readBody(req.body, id);
      const gate = await tombstoneGate(res, user.id, id, updatedAt);
      if (!gate) return;
      const updated = await repo.update(user.id, id, { name, updatedAt, payload });
      if (!updated) {
        res.status(404).json({ error: 'Contest not found' });
        return;
      }
      if (gate.stale) await repo.clearTombstone(user.id, id);
      await recordEvent({
        occurredAt: clock().toISOString(),
        userId: user.id,
        userEmail: user.email,
        type: CONTEST_EVENTS.updated,
        contestId: id,
        contestName: name,
      });
      res.json({ id, name, updatedAt });
    }),
  );

  // Delete an owned contest.
  //  - With `?deletedAt=<ISO>` (tombstone-aware clients): 409 `{ updatedAt }`
  //    when the row was edited after `deletedAt`; otherwise remove the row if
  //    present, record the tombstone, 204. A malformed value is a 400.
  //  - Without it (older clients): 404 if missing or owned by someone else,
  //    else remove it, 204. No tombstone.
  router.delete(
    '/:id',
    authed(async (req, res, user) => {
      const id = String(req.params.id);
      const deletedAt = readDeletedAt(req.query.deletedAt);
      if (deletedAt !== undefined) {
        const result = await repo.removeAsOf(user.id, id, deletedAt);
        if (result.outcome === 'newer') {
          res.status(409).json({ error: 'Contest was edited after the delete', updatedAt: result.updatedAt });
          return;
        }
        if (result.name !== undefined) {
          await recordEvent({
            occurredAt: clock().toISOString(),
            userId: user.id,
            userEmail: user.email,
            type: CONTEST_EVENTS.deleted,
            contestId: id,
            contestName: result.name,
          });
        }
        res.status(204).end();
        return;
      }
      // Read the row first so the delete event can retain the contest name after
      // the row is gone; a missing row is the 404 (nothing to delete or log).
      const existing = await repo.getOwned(user.id, id);
      if (!existing) {
        res.status(404).json({ error: 'Contest not found' });
        return;
      }
      await repo.remove(user.id, id);
      await recordEvent({
        occurredAt: clock().toISOString(),
        userId: user.id,
        userEmail: user.email,
        type: CONTEST_EVENTS.deleted,
        contestId: id,
        contestName: existing.name,
      });
      res.status(204).end();
    }),
  );

  return router;
}
