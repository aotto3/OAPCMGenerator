/**
 * Telemetry ingest — the one authenticated endpoint the browser posts to so the
 * activity log can record actions the server never sees itself (documents
 * generated, contest file export/import, uncaught client errors). It writes into
 * the same append-only event log as the contest routes, stamped with the
 * caller's id + email.
 *
 * Two guardrails keep the log trustworthy: the event `type` must be one of a
 * fixed allowlist (an unknown type is a 400, so a client can't invent entries —
 * PRD user story 21), and the optional `detail` blob is size-capped (an
 * oversized payload is a 400). The server still never receives or stores contest
 * contents or credentials here — only metadata the client chooses to report.
 */
import { Router, type Request, type Response } from 'express';
import type { EventLog } from './eventLog';
import type { AuthUser, ResolveUser } from './contestRoutes';
import { TELEMETRY_EVENT_TYPES } from './eventTypes';

/** Max serialized size of a telemetry `detail` blob. Bigger ⇒ 400. */
export const MAX_DETAIL_BYTES = 4096;

export interface TelemetryRoutesDeps {
  eventLog: EventLog;
  resolveUser: ResolveUser;
}

/** Reads an optional string field, ignoring anything that isn't a non-empty string. */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function createTelemetryRoutes(deps: TelemetryRoutesDeps): Router {
  const { eventLog, resolveUser } = deps;
  const router = Router();

  router.post('/', async (req: Request, res: Response): Promise<void> => {
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

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
      string,
      unknown
    >;
    const { type } = body;
    if (typeof type !== 'string' || !TELEMETRY_EVENT_TYPES.has(type)) {
      res.status(400).json({ error: 'Unknown telemetry event type' });
      return;
    }

    // Cap the optional detail blob so a client can't write a runaway row.
    let detail: unknown;
    if (body.detail !== undefined && body.detail !== null) {
      const encoded = JSON.stringify(body.detail);
      if (encoded !== undefined && Buffer.byteLength(encoded, 'utf8') > MAX_DETAIL_BYTES) {
        res.status(400).json({ error: 'Telemetry detail too large' });
        return;
      }
      detail = body.detail;
    }

    try {
      await eventLog.recordEvent({
        occurredAt: new Date().toISOString(),
        userId: user.id,
        userEmail: user.email,
        type,
        contestId: optionalString(body.contestId),
        contestName: optionalString(body.contestName),
        detail,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to record telemetry event', err);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    res.status(204).end();
  });

  return router;
}
