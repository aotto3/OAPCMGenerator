import { useEffect, useState } from 'react';
import { fetchErrorGroups, type ErrorGroup } from './adminClient';

/**
 * The Errors tab (Group F, slice F3). Lists client-error groups fingerprinted by
 * the server's errorTriage module — one row per bug, with count, first/last-seen,
 * affected-user count, and latest app version. Read-only: there is no "resolved"
 * state. Drill-down to individual occurrences reuses the F1 widened feed via the
 * injected `onDrilldown` (Activity tab filtered to client errors). Loads its own
 * data + owns the window picker; untested by convention like the rest of the panel.
 */

const WINDOWS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function ErrorsTab({ onDrilldown }: { onDrilldown: () => void }) {
  const [windowDays, setWindowDays] = useState(30);
  const [groups, setGroups] = useState<ErrorGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setGroups(null);
    setError(null);
    fetchErrorGroups(windowDays)
      .then((g) => active && setGroups(g))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [windowDays]);

  return (
    <section className="admin-card" aria-label="Error triage">
      <div className="admin-feed-head">
        <h2>Errors</h2>
        <div className="admin-window" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              className={`admin-window-btn${windowDays === w.days ? ' admin-window-active' : ''}`}
              onClick={() => setWindowDays(w.days)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="muted">Error triage unavailable.</p>
      ) : groups === null ? (
        <p className="muted">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="muted">No client errors in this window. 🎉</p>
      ) : (
        <>
          <div className="admin-table-scroll">
            <table className="admin-table admin-errors">
              <thead>
                <tr>
                  <th>Error</th>
                  <th className="admin-num">Count</th>
                  <th className="admin-num">Users</th>
                  <th>Last seen</th>
                  <th>First seen</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.fingerprint} onClick={onDrilldown}>
                    <td className="admin-error-msg" title={g.sampleMessage}>
                      {g.sampleMessage || <span className="muted">(no message)</span>}
                    </td>
                    <td className="admin-num">{g.count.toLocaleString()}</td>
                    <td className="admin-num">{g.affectedUsers.toLocaleString()}</td>
                    <td>{fmtDateTime(g.lastSeen)}</td>
                    <td>{fmtDateTime(g.firstSeen)}</td>
                    <td>{g.latestAppVersion ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted admin-active-filter">
            Click a row to see individual occurrences in the Activity feed.
          </p>
        </>
      )}
    </section>
  );
}
