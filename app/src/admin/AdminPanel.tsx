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

/**
 * The admin panel (PRD user stories 1–7). A read-only window on accounts and
 * the activity log: a stats strip, a users table, a paginated activity feed
 * filterable by user, and a per-user drill-down (their contest metadata + their
 * activity). Every byte here is metadata the server already holds — no contest
 * contents are ever fetched or shown. Rendered only after a positive am-I-admin
 * probe; the server independently re-checks admin on every request behind this.
 */

const PAGE_SIZE = 25;

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

// Human labels for the event types the log records (contest routes today;
// telemetry types land with slice #58). Unknown types fall back to the raw id.
const EVENT_LABELS: Record<string, string> = {
  'contest.created': 'Created contest',
  'contest.updated': 'Saved contest',
  'contest.deleted': 'Deleted contest',
  'documents.generated': 'Generated documents',
  'contest.exported': 'Exported file',
  'contest.imported': 'Imported file',
  'client.error': 'Client error',
};
const eventLabel = (type: string): string => EVENT_LABELS[type] ?? type;

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-stat">
      <span className="admin-stat-value">{value.toLocaleString()}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  );
}

export function AdminPanel({ onBack }: { onBack: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [contests, setContests] = useState<AdminContest[] | null>(null);
  const [page, setPage] = useState<EventPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  // Activity feed reloads when the user filter or page changes.
  useEffect(() => {
    let active = true;
    fetchEvents({ userId: selected?.id, limit: PAGE_SIZE, offset })
      .then((p) => active && setPage(p))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [selected, offset]);

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

  function selectUser(u: AdminUser | null) {
    setSelected(u);
    setOffset(0);
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

      <section className="admin-stats" aria-label="Summary stats">
        <StatCard label="Users" value={stats?.totalUsers ?? 0} />
        <StatCard label="Active this week" value={stats?.activeThisWeek ?? 0} />
        <StatCard label="Contests" value={stats?.totalContests ?? 0} />
        <StatCard label="Documents generated" value={stats?.documentsGenerated ?? 0} />
      </section>

      <div className="admin-grid">
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
                      onClick={() => selectUser(u)}
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

        <section className="admin-card" aria-label="Activity feed">
          <div className="admin-feed-head">
            <h2>Activity</h2>
            {selected && (
              <span className="admin-filter">
                {selected.email}
                <button className="btn-ghost" onClick={() => selectUser(null)}>
                  Show all
                </button>
              </span>
            )}
          </div>

          {page === null ? (
            <p className="muted">Loading…</p>
          ) : page.events.length === 0 ? (
            <p className="muted">No activity yet.</p>
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
      </div>

      {selected && (
        <section className="admin-card" aria-label="User contests">
          <h2>
            Contests for {selected.email}
            <span className="muted"> · {selected.contestCount}</span>
          </h2>
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
    </main>
  );
}
