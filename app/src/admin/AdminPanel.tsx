import { useEffect, useState } from 'react';
import {
  fetchEvents,
  fetchStats,
  fetchUserContests,
  fetchUsers,
  type AdminContest,
  type AdminEvent,
  type AdminStats,
  type AdminUser,
  type EventPage,
} from './adminClient';
import { AnalyticsTab } from './AnalyticsTab';
import { ErrorsTab } from './ErrorsTab';

/**
 * The admin panel (PRD #54, extended by Group F). A read-only window on accounts
 * and the activity log, organized into tabs — Overview · Activity · Errors ·
 * Users — so each concern has room to grow and loads its own data:
 *
 *  - Overview: the summary stats strip (analytics charts land in F2).
 *  - Activity: the paginated feed with the widened filters (user, type, contest,
 *    date range, free text), any combination ANDed server-side.
 *  - Errors: grouped client-error triage (filled in F3).
 *  - Users: the account directory + per-user contest drill-down.
 *
 * Every byte here is metadata the server already holds — no contest contents are
 * ever fetched or shown. Rendered only after a positive am-I-admin probe; the
 * server independently re-checks admin on every request behind this.
 */

const PAGE_SIZE = 25;

type Tab = 'overview' | 'activity' | 'errors' | 'users';
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'errors', label: 'Errors' },
  { id: 'users', label: 'Users' },
];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

// Human labels for the event types the log records. Also the type-filter option
// list on the Activity tab. Unknown types fall back to the raw id.
const EVENT_LABELS: Record<string, string> = {
  'contest.created': 'Created contest',
  'contest.updated': 'Saved contest',
  'contest.deleted': 'Deleted contest',
  'documents.generated': 'Generated documents',
  'contest.exported': 'Exported file',
  'contest.imported': 'Imported file',
  'client.error': 'Client error',
};
const EVENT_TYPES = Object.keys(EVENT_LABELS);
const eventLabel = (type: string): string => EVENT_LABELS[type] ?? type;

/** Turns a `yyyy-mm-dd` date input into an inclusive ISO instant bound. */
function dayBound(day: string, end: boolean): string | undefined {
  return day ? `${day}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : undefined;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-stat">
      <span className="admin-stat-value">{value.toLocaleString()}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  );
}

export function AdminPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Activity-feed filters (any combination, ANDed server-side).
  const [userId, setUserId] = useState('');
  const [type, setType] = useState('');
  const [contestId, setContestId] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<EventPage | null>(null);

  // Users-tab drill-down.
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [contests, setContests] = useState<AdminContest[] | null>(null);

  // Stats + users load once.
  useEffect(() => {
    let active = true;
    Promise.all([fetchStats(), fetchUsers()])
      .then(([s, u]) => {
        if (!active) return;
        setStats(s);
        setUsers(u);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, []);

  // Activity feed reloads whenever a filter or the page changes.
  useEffect(() => {
    let active = true;
    fetchEvents({
      userId: userId || undefined,
      type: type || undefined,
      contestId: contestId || undefined,
      from: dayBound(fromDay, false),
      to: dayBound(toDay, true),
      text: text || undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((p) => active && setPage(p))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [userId, type, contestId, fromDay, toDay, text, offset]);

  // Drill-down: the selected user's contest metadata.
  useEffect(() => {
    if (!selected) {
      setContests(null);
      return;
    }
    let active = true;
    void fetchUserContests(selected.id).then((c) => active && setContests(c));
    return () => {
      active = false;
    };
  }, [selected]);

  // Any filter change restarts paging at the first page.
  function onFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setOffset(0);
    };
  }
  const clearFilters = () => {
    setUserId('');
    setType('');
    setContestId('');
    setFromDay('');
    setToDay('');
    setText('');
    setOffset(0);
  };
  const hasFilters = !!(userId || type || contestId || fromDay || toDay || text);
  const userEmail = (id: string) => users?.find((u) => u.id === id)?.email ?? id;

  // Jump from the Users tab into the Activity tab, pre-scoped to that user.
  function viewActivity(u: AdminUser) {
    clearFilters();
    setUserId(u.id);
    setTab('activity');
  }

  // Drill from the Errors tab into the Activity feed, filtered to client errors.
  function viewClientErrors() {
    clearFilters();
    setType('client.error');
    setTab('activity');
  }

  const total = page?.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <main className="page admin">
      <div className="admin-topbar">
        <button className="btn-ghost" onClick={onBack}>
          ← Back to contests
        </button>
        <h1>Admin</h1>
      </div>

      {error && (
        <p className="import-error" role="alert">
          ⚠️ {error}
        </p>
      )}

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`admin-tab${tab === t.id ? ' admin-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <section className="admin-stats" aria-label="Summary stats">
            <StatCard label="Users" value={stats?.totalUsers ?? 0} />
            <StatCard label="Active this week" value={stats?.activeThisWeek ?? 0} />
            <StatCard label="Contests" value={stats?.totalContests ?? 0} />
            <StatCard label="Documents generated" value={stats?.documentsGenerated ?? 0} />
          </section>
          <AnalyticsTab />
        </>
      )}

      {tab === 'activity' && (
        <section className="admin-card" aria-label="Activity feed">
          <div className="admin-feed-head">
            <h2>Activity</h2>
            {hasFilters && (
              <button className="btn-ghost" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>

          <div className="admin-filters" role="search">
            <label>
              <span>User</span>
              <select value={userId} onChange={(e) => onFilter(setUserId)(e.target.value)}>
                <option value="">All users</option>
                {(users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Type</span>
              <select value={type} onChange={(e) => onFilter(setType)(e.target.value)}>
                <option value="">All types</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {eventLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>From</span>
              <input type="date" value={fromDay} onChange={(e) => onFilter(setFromDay)(e.target.value)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={toDay} onChange={(e) => onFilter(setToDay)(e.target.value)} />
            </label>
            <label className="admin-filter-contest">
              <span>Contest ID</span>
              <input
                type="text"
                value={contestId}
                placeholder="contest id"
                onChange={(e) => onFilter(setContestId)(e.target.value)}
              />
            </label>
            <label className="admin-filter-search">
              <span>Search</span>
              <input
                type="search"
                value={text}
                placeholder="email, contest, or error text"
                onChange={(e) => onFilter(setText)(e.target.value)}
              />
            </label>
          </div>

          {page === null ? (
            <p className="muted">Loading…</p>
          ) : page.events.length === 0 ? (
            <p className="muted">No activity matches these filters.</p>
          ) : (
            <>
              <ul className="admin-feed">
                {page.events.map((e: AdminEvent) => (
                  <li key={e.seq} className="admin-feed-row">
                    <span className="admin-feed-when">{fmtDateTime(e.occurredAt)}</span>
                    <span className="admin-feed-who">{e.userEmail}</span>
                    <span className="admin-feed-what">
                      {eventLabel(e.type)}
                      {e.contestName ? <span className="muted"> · {e.contestName}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="admin-pager">
                <button
                  className="btn-secondary btn-sm"
                  disabled={!canPrev}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  ← Newer
                </button>
                <span className="muted">
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <button
                  className="btn-secondary btn-sm"
                  disabled={!canNext}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Older →
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'errors' && <ErrorsTab onDrilldown={viewClientErrors} />}

      {tab === 'users' && (
        <>
          <section className="admin-card" aria-label="Users">
            <h2>Users</h2>
            {users === null ? (
              <p className="muted">Loading…</p>
            ) : users.length === 0 ? (
              <p className="muted">No users yet.</p>
            ) : (
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Joined</th>
                      <th>Last seen</th>
                      <th className="admin-num">Contests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.id}
                        className={selected?.id === u.id ? 'admin-row-selected' : undefined}
                        onClick={() => setSelected(u)}
                        aria-selected={selected?.id === u.id}
                      >
                        <td>{u.email}</td>
                        <td>{fmtDate(u.createdAt)}</td>
                        <td>{fmtDate(u.lastSeenAt)}</td>
                        <td className="admin-num">{u.contestCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {selected && (
            <section className="admin-card" aria-label="User drill-down">
              <div className="admin-feed-head">
                <h2>
                  {selected.email}
                  <span className="muted"> · {selected.contestCount} contests</span>
                </h2>
                <button className="btn-secondary btn-sm" onClick={() => viewActivity(selected)}>
                  View activity →
                </button>
              </div>
              {contests === null ? (
                <p className="muted">Loading…</p>
              ) : contests.length === 0 ? (
                <p className="muted">No contests.</p>
              ) : (
                <ul className="admin-contest-list">
                  {contests.map((c) => (
                    <li key={c.id}>
                      <span>{c.name}</span>
                      <span className="muted"> · last edited {fmtDateTime(c.updatedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {tab === 'activity' && userId && (
        <p className="muted admin-active-filter">Showing activity for {userEmail(userId)}.</p>
      )}
    </main>
  );
}
