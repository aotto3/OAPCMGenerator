import { useEffect, useState } from 'react';
import { fetchAnalytics, type AdminAnalytics, type TrendBucket } from './adminClient';

/**
 * The Overview tab's analytics view (Group F, slice F2). Renders the server's
 * on-read analytics report as small, self-contained inline SVG charts — no chart
 * library, consistent with the app's no-CDN / self-contained posture. Loads its
 * own data and owns the window picker, so opening the panel pays only for the
 * view being looked at. Untested by convention like the rest of the panel.
 */

const WINDOWS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

function bucketTitle(start: string, weekly: boolean, value: number, unit: string): string {
  const d = new Date(start);
  const when = isNaN(d.getTime()) ? start : d.toLocaleDateString();
  return `${weekly ? 'Week of ' : ''}${when}: ${value.toLocaleString()} ${unit}`;
}

/** A mini bar chart over the series, one bar per bucket. Stretches to its box. */
function Sparkbars({
  series,
  pick,
  unit,
  weekly,
}: {
  series: TrendBucket[];
  pick: (b: TrendBucket) => number;
  unit: string;
  weekly: boolean;
}) {
  const values = series.map(pick);
  const max = Math.max(1, ...values);
  const n = Math.max(values.length, 1);
  const W = 100;
  const H = 32;
  const gap = n > 40 ? 0 : 1;
  const bw = W / n;
  return (
    <svg
      className="admin-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${unit} per ${weekly ? 'week' : 'day'}`}
    >
      {values.map((v, i) => {
        const h = (v / max) * (H - 2);
        return (
          <rect
            key={i}
            x={i * bw + gap / 2}
            y={H - h}
            width={Math.max(bw - gap, 0.5)}
            height={h}
            fill="var(--c-blue)"
          >
            <title>{bucketTitle(series[i].start, weekly, v, unit)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function TrendCard({
  label,
  total,
  children,
}: {
  label: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-trend">
      <div className="admin-trend-head">
        <span className="admin-trend-label">{label}</span>
        <span className="admin-trend-total">{total.toLocaleString()}</span>
      </div>
      {children}
    </div>
  );
}

/** A labeled horizontal ratio bar (e.g. adoption). */
function RatioBar({ label, ratio, users, totalUsers }: { label: string; ratio: number; users: number; totalUsers: number }) {
  return (
    <div className="admin-ratio">
      <div className="admin-ratio-head">
        <span>{label}</span>
        <span className="muted">
          {users} / {totalUsers} · {pct(ratio)}
        </span>
      </div>
      <div className="admin-ratio-track">
        <div className="admin-ratio-fill" style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
      </div>
    </div>
  );
}

// Human labels for the volume breakdown; unknown types fall back to the raw id.
const TYPE_LABELS: Record<string, string> = {
  'contest.created': 'Created contest',
  'contest.updated': 'Saved contest',
  'contest.deleted': 'Deleted contest',
  'documents.generated': 'Generated documents',
  'contest.exported': 'Exported file',
  'contest.imported': 'Imported file',
  'client.error': 'Client error',
};

export function AnalyticsTab() {
  const [windowDays, setWindowDays] = useState(30);
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    fetchAnalytics(windowDays)
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [windowDays]);

  const weekly = data?.window.bucket === 'week';
  const maxVolume = Math.max(1, ...(data?.volumeByType.map((v) => v.count) ?? []));

  return (
    <section className="admin-card" aria-label="Analytics">
      <div className="admin-feed-head">
        <h2>Analytics</h2>
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
        <p className="muted">Analytics unavailable.</p>
      ) : data === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="admin-trends">
            <TrendCard label="Signups" total={data.totals.signups}>
              <Sparkbars series={data.series} pick={(b) => b.signups} unit="signups" weekly={weekly} />
            </TrendCard>
            <TrendCard label="Active users" total={data.totals.activeUsers}>
              <Sparkbars series={data.series} pick={(b) => b.activeUsers} unit="active users" weekly={weekly} />
            </TrendCard>
            <TrendCard label="Contests created" total={data.totals.contestsCreated}>
              <Sparkbars series={data.series} pick={(b) => b.contestsCreated} unit="contests" weekly={weekly} />
            </TrendCard>
            <TrendCard label="Documents generated" total={data.totals.documentsGenerated}>
              <Sparkbars series={data.series} pick={(b) => b.documentsGenerated} unit="doc builds" weekly={weekly} />
            </TrendCard>
            <TrendCard label="Errors" total={data.totals.errors}>
              <Sparkbars series={data.series} pick={(b) => b.errors} unit="errors" weekly={weekly} />
            </TrendCard>
          </div>

          <div className="admin-analytics-grid">
            <div>
              <h3 className="admin-subhead">Adoption</h3>
              <RatioBar
                label="Created a contest"
                ratio={data.adoption.createdContest.ratio}
                users={data.adoption.createdContest.users}
                totalUsers={data.adoption.totalUsers}
              />
              <RatioBar
                label="Generated documents"
                ratio={data.adoption.generatedDocuments.ratio}
                users={data.adoption.generatedDocuments.users}
                totalUsers={data.adoption.totalUsers}
              />
              <RatioBar
                label="Exported a file"
                ratio={data.adoption.exported.ratio}
                users={data.adoption.exported.users}
                totalUsers={data.adoption.totalUsers}
              />
              <p className="muted admin-retention">
                {data.retention.activeUsers.toLocaleString()} active ·{' '}
                {data.retention.returningUsers.toLocaleString()} returning (2+ periods)
              </p>
            </div>

            <div>
              <h3 className="admin-subhead">Activity mix</h3>
              {data.volumeByType.length === 0 ? (
                <p className="muted">No activity in this window.</p>
              ) : (
                <ul className="admin-volume">
                  {data.volumeByType.map((v) => (
                    <li key={v.type}>
                      <span className="admin-volume-label">{TYPE_LABELS[v.type] ?? v.type}</span>
                      <span className="admin-volume-track">
                        <span className="admin-volume-fill" style={{ width: `${(v.count / maxVolume) * 100}%` }} />
                      </span>
                      <span className="admin-volume-count">{v.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
