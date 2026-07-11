/**
 * Typed browser client for the admin API (Slice #57 server). Same network shape
 * as the sync client: credentialed, same-origin by default (the frontend proxy
 * forwards /api/* to the API), VITE_API_URL only to override. Every admin route
 * is 404 for non-admins, so `probeAdmin` treats any non-2xx as "not admin" and
 * the app simply never renders the panel — no error surfaced to a regular user.
 *
 * The data this exposes is metadata only (event types, contest names, user
 * emails, counts). The server never returns a contest payload here, and this
 * client never asks for one.
 */

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

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Admin request failed: ${res.status}`);
  return (await res.json()) as T;
}

/** True iff the current session is an admin. Any failure (incl. 404) → false. */
export async function probeAdmin(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/admin/me`, { credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}

export function fetchStats(): Promise<AdminStats> {
  return getJson<AdminStats>('/api/admin/stats');
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const body = await getJson<{ users: AdminUser[] }>('/api/admin/users');
  return body.users;
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

/**
 * A page of the activity feed, newest-first, narrowed by any combination of the
 * feed filters (user, type, contest, date range, free text) plus paging. Empty
 * filter values are omitted so the default is the whole feed.
 */
export function fetchEvents(opts: EventFilters & { limit: number; offset: number }): Promise<EventPage> {
  const params = new URLSearchParams({ limit: String(opts.limit), offset: String(opts.offset) });
  if (opts.userId) params.set('userId', opts.userId);
  if (opts.type) params.set('type', opts.type);
  if (opts.contestId) params.set('contestId', opts.contestId);
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.text) params.set('text', opts.text);
  return getJson<EventPage>(`/api/admin/events?${params.toString()}`);
}

export async function fetchUserContests(userId: string): Promise<AdminContest[]> {
  const body = await getJson<{ contests: AdminContest[] }>(
    `/api/admin/users/${encodeURIComponent(userId)}/contests`,
  );
  return body.contests;
}
