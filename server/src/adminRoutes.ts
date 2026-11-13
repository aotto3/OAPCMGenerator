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
import { resolveUserOrNull, type AuthUser, type ResolveUser } from './requestAuth';
import { DOCUMENTS_GENERATED_EVENT } from './eventTypes';
import { bucketForDays, computeAnalytics, type AnalyticsWindow } from './eventAnalytics';
import { groupErrors } from './errorTriage';
import { ADMIN_EVENTS, TELEMETRY_EVENTS } from './eventTypes';
import { computeSyncHealth } from './syncHealth';
import { createRateLimiter } from './rateLimiter';
import type { AuthAdmin } from './authAdmin';
import type { EmailTemplateStore } from './emailTemplateStore';

/** How far back the drill-down looks for a user's "recent" errors. */
const RECENT_EVENT_WINDOW_DAYS = 14;

/** Resend sign-in link: at most this many sends per target email per window. */
const RESEND_LIMIT = 3;
const RESEND_WINDOW_MS = 15 * 60 * 1000;

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
  /** The one account-acting seam (resend sign-in link). */
  authAdmin: AuthAdmin;
  /** Email templates, for gallery moderation (PRD #320). */
  emailTemplateStore: EmailTemplateStore;
  resolveUser: ResolveUser;
  /** Lowercased admin email allowlist (see env.adminEmails). */
  adminEmails: ReadonlySet<string>;
  /** Injected clock; every timestamp this router stamps or compares comes from it. */
  now: () => Date;
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
function parseWindow(req: Request, nowMs: number): AnalyticsWindow {
  const raw = Math.trunc(Number(req.query.window));
  const days = Number.isFinite(raw) && raw >= 1 ? Math.min(raw, MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;
  const toMs = nowMs;
  return {
    from: new Date(toMs - days * DAY_MS).toISOString(),
    to: new Date(toMs).toISOString(),
    bucket: bucketForDays(days),
  };
}

export function createAdminRoutes(deps: AdminRoutesDeps): Router {
  const { repo, eventLog, userDirectory, authAdmin, emailTemplateStore, resolveUser, adminEmails, now } = deps;
  const router = Router();

  // Per-target-email limiter for the resend action (in-memory; one API process).
  const resendLimiter = createRateLimiter({ limit: RESEND_LIMIT, windowMs: RESEND_WINDOW_MS, now: () => now().getTime() });

  /**
   * Wraps a handler with the admin gate. Resolves the session; if there is none
   * or its email is not allowlisted, answers 404 (the surface stays dark). Any
   * unexpected error inside a handler becomes a 500.
   */
  const adminOnly =
    (handler: (req: Request, res: Response, admin: AuthUser) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      const user = await resolveUserOrNull(req, resolveUser);
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

  // What this request looks like to the API through the proxy chain (#261): the
  // address Express derives under the current `trust proxy`, the full forwarded
  // list, the raw headers and the socket peer. Read once to pick the hop count
  // that makes `ip` the real client.
  router.get(
    '/request-ip',
    adminOnly(async (req, res) => {
      res.json({
        ip: req.ip ?? null,
        ips: req.ips,
        forwardedFor: req.header('x-forwarded-for') ?? null,
        realIp: req.header('x-real-ip') ?? null,
        remoteAddress: req.socket.remoteAddress ?? null,
      });
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
      const cutoff = now().getTime() - ACTIVE_WINDOW_MS;
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
      const window = parseWindow(req, now().getTime());
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
      const window = parseWindow(req, now().getTime());
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
      const from = new Date(now().getTime() - RECENT_EVENT_WINDOW_DAYS * DAY_MS).toISOString();
      const [contests, events] = await Promise.all([
        repo.listByOwner(id),
        eventLog.listEvents({ userId: id, from }),
      ]);
      const syncHealth = computeSyncHealth({ contests, events, now: now().toISOString() });
      res.json({ user, syncHealth });
    }),
  );

  // Support action (the ONE account write): resend a fresh sign-in link to a
  // locked-out user. Guarded by a per-target-email rate limit (429 without
  // sending when exceeded) and audited with a server-authored event naming actor
  // + target. Behind the adminOnly gate like everything else (PRD stories 21-24).
  router.post(
    '/users/:id/resend-signin',
    adminOnly(async (req, res, admin) => {
      const id = String(req.params.id);
      const user = await userDirectory.getUser(id);
      if (!user) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      if (!resendLimiter.tryAcquire(user.email.toLowerCase())) {
        res.status(429).json({ error: 'A sign-in link was sent recently. Please wait before resending.' });
        return;
      }
      await authAdmin.sendSignInLink(user.email);
      // Audit best-effort, like the contest routes — a logging hiccup must not
      // fail the support action the admin already performed.
      try {
        await eventLog.recordEvent({
          occurredAt: now().toISOString(),
          userId: admin.id,
          userEmail: admin.email,
          type: ADMIN_EVENTS.signInLinkResent,
          detail: { targetUserId: id, targetEmail: user.email },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to record admin.signin_link_resent event', err);
      }
      res.status(204).end();
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

  // Gallery moderation (PRD #320, slice #326): every shared email template with
  // its author's name and account email, so the admin can review what is shared.
  router.get(
    '/shared-templates',
    adminOnly(async (_req, res) => {
      const shared = await emailTemplateStore.listSharedForAdmin();
      const emails = new Map<string, string | undefined>();
      for (const id of new Set(shared.map((t) => t.ownerId))) {
        emails.set(id, (await userDirectory.getUser(id))?.email);
      }
      res.json({
        templates: shared.map((t) => ({ ...t, ownerEmail: emails.get(t.ownerId) ?? null })),
      });
    }),
  );

  // Takes a template out of the gallery. The author keeps it, now private.
  // Audited best-effort by template name only, never its text.
  router.delete(
    '/shared-templates/:id',
    adminOnly(async (req, res, admin) => {
      const result = await emailTemplateStore.adminUnshare(String(req.params.id));
      if (result.kind === 'not_found') {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      try {
        await eventLog.recordEvent({
          occurredAt: now().toISOString(),
          userId: admin.id,
          userEmail: admin.email,
          type: ADMIN_EVENTS.templateRemovedFromGallery,
          detail: { templateName: result.name, targetUserId: result.ownerId },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to record admin.template_removed_from_gallery event', err);
      }
      res.status(204).end();
    }),
  );

  return router;
}
