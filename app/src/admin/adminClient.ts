/**
 * Typed browser client for the admin API (Slice #57 server), built on the shared
 * transport (`api/http.ts`): credentialed and same-origin. Every admin route
 * is 404 for non-admins, so `probeAdmin` treats any non-2xx as "not admin" and
 * the app simply never renders the panel — no error surfaced to a regular user.
 *
 * The data this exposes is metadata only (event types, contest names, user
 * emails, counts). The server never returns a contest payload here, and this
 * client never asks for one.
 */
import { ApiHttpError, createApi } from '../api/http';

export interface AdminStats {
  totalUsers: number;
  activeThisWeek: number;
  totalContests: number;
  documentsGenerated: number;
}

export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  lastSeenAt?: string;
  contestCount: number;
}

export interface AdminEvent {
  seq: number;
  occurredAt: string;
  userId: string;
  userEmail: string;
  type: string;
  contestId?: string;
  contestName?: string;
  detail?: unknown;
}

export interface AdminContest {
  id: string;
  name: string;
  updatedAt: string;
}

export interface EventPage {
  events: AdminEvent[];
  total: number;
}

/** One bucket of the analytics trend series (mirrors server eventAnalytics). */
export interface TrendBucket {
  start: string;
  signups: number;
  activeUsers: number;
  contestsCreated: number;
  documentsGenerated: number;
  errors: number;
}

export interface AdoptionRatio {
  users: number;
  ratio: number;
}

export interface AdminAnalytics {
  window: { from: string; to: string; bucket: 'day' | 'week' };
  series: TrendBucket[];
  totals: {
    signups: number;
    activeUsers: number;
    contestsCreated: number;
    documentsGenerated: number;
    errors: number;
  };
  adoption: {
    totalUsers: number;
    createdContest: AdoptionRatio;
    generatedDocuments: AdoptionRatio;
    exported: AdoptionRatio;
  };
  retention: { activeUsers: number; returningUsers: number };
  volumeByType: Array<{ type: string; count: number }>;
}

/** Filters for the activity feed — all optional, ANDed server-side. */
export interface EventFilters {
  userId?: string;
  type?: string;
  contestId?: string;
  /** Inclusive ISO instant lower bound. */
  from?: string;
  /** Inclusive ISO instant upper bound. */
  to?: string;
  /** Free text across email / contest name / error message. */
  text?: string;
}

/** A fingerprinted group of client errors (mirrors server errorTriage). */
export interface ErrorGroup {
  fingerprint: string;
  sampleMessage: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  affectedUsers: number;
  latestAppVersion?: string;
}

/** Per-user sync-health derived from server-visible signals (mirrors syncHealth). */
export interface SyncHealth {
  lastPushAt: string | null;
  staleDays: number | null;
  contestCount: number;
  recentErrorCount: number;
  status: 'healthy' | 'stale' | 'never-pushed';
}

export interface AdminUserDetail {
  user: { id: string; email: string; createdAt: string; lastSeenAt?: string };
  syncHealth: SyncHealth;
}

/** The admin panel's error for a failed request, as the panel has always shown it. */
function adminError(err: unknown): unknown {
  return err instanceof ApiHttpError ? new Error(`Admin request failed: ${err.status}`) : err;
}

/** The activity-feed path for a page of events; empty filter values are omitted. */
function eventsPath(opts: EventFilters & { limit: number; offset: number }): string {
  const params = new URLSearchParams({ limit: String(opts.limit), offset: String(opts.offset) });
  if (opts.userId) params.set('userId', opts.userId);
  if (opts.type) params.set('type', opts.type);
  if (opts.contestId) params.set('contestId', opts.contestId);
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.text) params.set('text', opts.text);
  return `/api/admin/events?${params.toString()}`;
}

const windowQuery = (windowDays?: number) => (windowDays ? `?window=${windowDays}` : '');
const userPath = (userId: string) => `/api/admin/users/${encodeURIComponent(userId)}`;

/** The admin API over an injectable fetch (tests); the app uses the default instance below. */
export function createAdminClient(fetchImpl?: typeof fetch) {
  const api = createApi(fetchImpl);
  async function getJson<T>(path: string): Promise<T> {
    try {
      return await api.get<T>(path);
    } catch (err) {
      throw adminError(err);
    }
  }

  return {
    /** True iff the current session is an admin. Any failure (incl. 404) is false. */
    async probeAdmin(): Promise<boolean> {
      try {
        await api.get('/api/admin/me');
        return true;
      } catch {
        return false;
      }
    },
    fetchStats(): Promise<AdminStats> {
      return getJson<AdminStats>('/api/admin/stats');
    },
    async fetchUsers(): Promise<AdminUser[]> {
      return (await getJson<{ users: AdminUser[] }>('/api/admin/users')).users;
    },
    /**
     * A page of the activity feed, newest-first, narrowed by any combination of
     * the feed filters (user, type, contest, date range, free text) plus paging.
     * Empty filter values are omitted so the default is the whole feed.
     */
    fetchEvents(opts: EventFilters & { limit: number; offset: number }): Promise<EventPage> {
      return getJson<EventPage>(eventsPath(opts));
    },
    /** Analytics report over a window of `windowDays` (server default 30 if omitted). */
    fetchAnalytics(windowDays?: number): Promise<AdminAnalytics> {
      return getJson<AdminAnalytics>(`/api/admin/analytics${windowQuery(windowDays)}`);
    },
    /** Client-error groups over a window (server default 30 days if omitted). */
    async fetchErrorGroups(windowDays?: number): Promise<ErrorGroup[]> {
      return (await getJson<{ groups: ErrorGroup[] }>(`/api/admin/errors${windowQuery(windowDays)}`)).groups;
    },
    /** One user's record + derived sync-health for the drill-down. */
    fetchUser(userId: string): Promise<AdminUserDetail> {
      return getJson<AdminUserDetail>(userPath(userId));
    },
    /**
     * Resends a fresh sign-in link to a user (the one account-acting admin call).
     * Returns 'sent' on success, 'rate-limited' on a 429, and throws on other failures.
     */
    async resendSignInLink(userId: string): Promise<'sent' | 'rate-limited'> {
      try {
        await api.send('POST', `${userPath(userId)}/resend-signin`);
        return 'sent';
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 429) return 'rate-limited';
        throw adminError(err);
      }
    },
    async fetchUserContests(userId: string): Promise<AdminContest[]> {
      return (await getJson<{ contests: AdminContest[] }>(`${userPath(userId)}/contests`)).contests;
    },
  };
}

export type AdminClient = ReturnType<typeof createAdminClient>;

const defaultClient = createAdminClient();

export const {
  probeAdmin,
  fetchStats,
  fetchUsers,
  fetchEvents,
  fetchAnalytics,
  fetchErrorGroups,
  fetchUser,
  resendSignInLink,
  fetchUserContests,
} = defaultClient;
