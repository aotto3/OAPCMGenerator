/**
 * The admin API — read-only observability over accounts and the activity log,
 * for the owner's admin panel. Every route sits behind one gate: the caller's
 * Better Auth session email must be in the injected `adminEmails` allowlist. A
 * caller who fails the gate (unauthenticated OR signed in but not allowlisted)
 * gets a flat 404 — never 401/403 — so the admin surface is indistinguishable
 * from routes that do not exist and cannot be probed for existence (PRD user
 * stories 12, 13).
 *
 * The data seams are injected exactly like the contest routes': the contest
 * repo, the event log, and the user directory (the only reader of Better Auth's
 * tables). Nothing here parses a contest payload — the panel reports metadata
 * (event type, contest name, user email, counts), never contents.
 */
import { Router, type Request, type Response } from 'express';
import type { ContestRepo } from './contestRepo';
import type { EventFilter, EventLog } from './eventLog';
import type { UserDirectory } from './userDirectory';
import type { AuthUser, ResolveUser } from './contestRoutes';
import { DOCUMENTS_GENERATED_EVENT } from './eventTypes';
import { bucketForDays, computeAnalytics, type AnalyticsWindow } from './eventAnalytics';
import { groupErrors } from './errorTriage';
import { TELEMETRY_EVENTS } from './eventTypes';
import { computeSyncHealth } from './syncHealth';

/** How far back the drill-down looks for a user's "recent" errors. */
const RECENT_EVENT_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A user is "active this week" if seen within this window. */
const ACTIVE_WINDOW_MS = 7 * DAY_MS;
/** Default analytics window when ?window is absent/invalid, and its clamp bounds. */
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

export interface AdminRoutesDeps {
  repo: ContestRepo;
  eventLog: EventLog;
  userDirectory: UserDirectory;
  resolveUser: ResolveUser;
  /** Lowercased admin email allowlist (see env.adminEmails). */
  adminEmails: ReadonlySet<string>;
}

/** Parses ?limit / ?offset, leaving them unset (log defaults apply) when absent/invalid. */
function pageParams(req: Request): { limit?: number; offset?: number } {
  const limit = Number(req.query.limit);
  const offset = Number(req.query.offset);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : undefined,
  };
}

/** Reads a query param as a trimmed non-empty string, else undefined. */
function strParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Parses the widened activity-feed filters from the query string: user, type,
 * contest, ISO date-range bounds, and free text. Each is optional — an absent or
 * blank param leaves that filter unset, so the endpoint's default is the same
 * unfiltered feed as before.
 */
function feedFilter(req: Request): EventFilter {
  return {
    userId: strParam(req.query.userId),
    type: strParam(req.query.type),
    contestId: strParam(req.query.contestId),
    from: strParam(req.query.from),
    to: strParam(req.query.to),
    text: strParam(req.query.text),
  };
}

/**
 * Derives the analytics window from ?window (a day count; default 30, clamped to
 * [1, 365]). `to` is now; `from` is that many days back; bucket granularity is
 * implied by the length (daily for short windows, weekly for long).
 */
function parseWindow(req: Request): AnalyticsWindow {
  const raw = Math.trunc(Number(req.query.window));
  const days = Number.isFinite(raw) && raw >= 1 ? Math.min(raw, MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;
  const toMs = Date.now();
  return {
    from: new Date(toMs - days * DAY_MS).toISOString(),
    to: new Date(toMs).toISOString(),
    bucket: bucketForDays(days),
  };
}

export function createAdminRoutes(deps: AdminRoutesDeps): Router {
  const { repo, eventLog, userDirectory, resolveUser, adminEmails } = deps;
  const router = Router();

  /**
   * Wraps a handler with the admin gate. Resolves the session; if there is none
   * or its email is not allowlisted, answers 404 (the surface stays dark). Any
   * unexpected error inside a handler becomes a 500.
   */
  const adminOnly =
    (handler: (req: Request, res: Response, admin: AuthUser) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      let user: AuthUser | null;
      try {
        user = await resolveUser(req);
      } catch {
        user = null;
      }
      if (!user || !adminEmails.has(user.email.toLowerCase())) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      try {
        await handler(req, res, user);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Unexpected error handling admin request', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    };

  // Am-I-admin probe. Reaching a 200 already means yes (the gate handles no);
  // the app renders its admin entry point only on this positive answer.
  router.get(
    '/me',
    adminOnly(async (_req, res) => {
      res.json({ admin: true });
    }),
  );

  // Summary stats strip.
  router.get(
    '/stats',
    adminOnly(async (_req, res) => {
      const [users, totalContests, documentsGenerated] = await Promise.all([
        userDirectory.listUsers(),
        repo.countAll(),
        eventLog.countEvents({ type: DOCUMENTS_GENERATED_EVENT }),
      ]);
      const cutoff = Date.now() - ACTIVE_WINDOW_MS;
      const activeThisWeek = users.filter(
        (u) => u.lastSeenAt !== undefined && new Date(u.lastSeenAt).getTime() >= cutoff,
      ).length;
      res.json({
        totalUsers: users.length,
        activeThisWeek,
        totalContests,
        documentsGenerated,
      });
    }),
  );

  // Users table: the account directory joined with each user's contest count.
  router.get(
    '/users',
    adminOnly(async (_req, res) => {
      const [users, counts] = await Promise.all([
        userDirectory.listUsers(),
        repo.countsByOwner(),
      ]);
      res.json({
        users: users.map((u) => ({ ...u, contestCount: counts[u.id] ?? 0 })),
      });
    }),
  );

  // Global activity feed, newest-first, paginated. Filterable by user, type,
  // contest, ISO date range, and free text — any combination (all ANDed). The
  // page and its total share one filter so they always agree.
  router.get(
    '/events',
    adminOnly(async (req, res) => {
      const filter = feedFilter(req);
      const { limit, offset } = pageParams(req);
      const [events, total] = await Promise.all([
        eventLog.queryEvents({ ...filter, limit, offset }),
        eventLog.countEvents(filter),
      ]);
      res.json({ events, total, limit, offset });
    }),
  );

  // Analytics: bucketed trends + adoption/retention/volume over a time window.
  // All computed on read from the windowed log rows + the account directory —
  // nothing precomputed or stored (PRD user story 6).
  router.get(
    '/analytics',
    adminOnly(async (req, res) => {
      const window = parseWindow(req);
      const [events, users] = await Promise.all([
        eventLog.listEvents({ from: window.from, to: window.to }),
        userDirectory.listUsers(),
      ]);
      res.json(computeAnalytics(events, users, window));
    }),
  );

  // Error triage: client.error events in the window, fingerprinted into groups.
  // Read-only — no "resolved" state, nothing stored (PRD user story 13). Drill to
  // occurrences via the feed filtered by type=client.error.
  router.get(
    '/errors',
    adminOnly(async (req, res) => {
      const window = parseWindow(req);
      const events = await eventLog.listEvents({
        type: TELEMETRY_EVENTS.clientError,
        from: window.from,
        to: window.to,
      });
      res.json({ window, groups: groupErrors(events) });
    }),
  );

  // Drill-down: one user's record + derived sync-health (server-visible signals
  // only — no pulls/conflicts/devices). Never returns a contest payload.
  router.get(
    '/users/:id',
    adminOnly(async (req, res) => {
      const id = String(req.params.id);
      const user = await userDirectory.getUser(id);
      if (!user) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const from = new Date(Date.now() - RECENT_EVENT_WINDOW_DAYS * DAY_MS).toISOString();
      const [contests, events] = await Promise.all([
        repo.listByOwner(id),
        eventLog.listEvents({ userId: id, from }),
      ]);
      const syncHealth = computeSyncHealth({ contests, events, now: new Date().toISOString() });
      res.json({ user, syncHealth });
    }),
  );

  // Drill-down: one user's contest metadata (id, name, timestamps — never payload).
  router.get(
    '/users/:id/contests',
    adminOnly(async (req, res) => {
      const contests = await repo.listByOwner(String(req.params.id));
      res.json({ contests });
    }),
  );

  // Drill-down: one user's personal activity feed, newest-first, paginated.
  router.get(
    '/users/:id/events',
    adminOnly(async (req, res) => {
      const userId = String(req.params.id);
      const { limit, offset } = pageParams(req);
      const [events, total] = await Promise.all([
        eventLog.queryEvents({ userId, limit, offset }),
        eventLog.countEvents({ userId }),
      ]);
      res.json({ events, total, limit, offset });
    }),
  );

  return router;
}
