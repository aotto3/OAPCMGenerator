/**
 * Analytics over the activity log — a PURE module (no I/O, no clock). The admin
 * analytics route fetches the windowed event rows and the account list and hands
 * them here; everything is computed on read, nothing is stored or precomputed.
 *
 * The whole report is scoped to one time window [from, to): the bucketed trend
 * series, the adoption ratios, the retention counts, and the per-type volume are
 * all "within this window." That is deliberate — the window picker (7 / 30 / 90
 * days) exists so the owner can zoom from "this week" out to "this season", and
 * OAP usage is heavily seasonal (Jan–Apr), so an all-time figure would drown the
 * signal. "Ever created a contest" therefore means "created one in this window".
 *
 * Depends only on the record shapes, so it unit-tests in isolation like the
 * contest model / critique.ts pure suites.
 */
import type { EventRecord } from './eventLog';
import type { UserRecord } from './userDirectory';
import { TELEMETRY_EVENTS } from './eventTypes';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Windows up to this many days bucket daily; longer windows bucket weekly. */
export const DAILY_BUCKET_MAX_DAYS = 31;

/** The event types the series and adoption ratios key off. */
const CONTEST_CREATED = 'contest.created';
const DOCUMENTS_GENERATED = TELEMETRY_EVENTS.documentsGenerated;
const CONTEST_EXPORTED = TELEMETRY_EVENTS.contestExported;
const CLIENT_ERROR = TELEMETRY_EVENTS.clientError;

export type BucketGranularity = 'day' | 'week';

/** The analysis window: a half-open [from, to) range and its bucket size. */
export interface AnalyticsWindow {
  /** Inclusive ISO instant lower bound. */
  from: string;
  /** Exclusive ISO instant upper bound (typically "now"). */
  to: string;
  bucket: BucketGranularity;
}

/** One bucket of the trend series. `start` is the bucket's ISO lower bound. */
export interface TrendBucket {
  start: string;
  signups: number;
  activeUsers: number;
  contestsCreated: number;
  documentsGenerated: number;
  errors: number;
}

/** A count of users who did an action in-window plus that count over all accounts. */
export interface AdoptionRatio {
  /** Distinct users who performed the action within the window. */
  users: number;
  /** users / totalUsers, in [0, 1]; 0 when there are no accounts. */
  ratio: number;
}

export interface AnalyticsReport {
  window: AnalyticsWindow;
  /** One entry per bucket, oldest first. */
  series: TrendBucket[];
  /** Window totals (the series summed), for headline figures. */
  totals: {
    signups: number;
    activeUsers: number;
    contestsCreated: number;
    documentsGenerated: number;
    errors: number;
  };
  /** What fraction of all accounts took each key action within the window. */
  adoption: {
    totalUsers: number;
    createdContest: AdoptionRatio;
    generatedDocuments: AdoptionRatio;
    exported: AdoptionRatio;
  };
  /** Simple stickiness signals over the window (see notes on seasonality). */
  retention: {
    /** Distinct users active (any event) in the window. */
    activeUsers: number;
    /** Distinct users active in two or more buckets. */
    returningUsers: number;
  };
  /** Per-event-type counts within the window, most frequent first. */
  volumeByType: Array<{ type: string; count: number }>;
}

/** Parses an ISO instant to epoch ms, or null if unparseable. */
function ms(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Chooses the bucket granularity implied by a window length in days. */
export function bucketForDays(days: number): BucketGranularity {
  return days <= DAILY_BUCKET_MAX_DAYS ? 'day' : 'week';
}

/**
 * Computes the full analytics report from the windowed events and the account
 * list. `events` is expected to already be scoped to the window by the caller,
 * but membership is re-checked here so the module is self-contained and safe
 * against a loose fetch.
 */
export function computeAnalytics(
  events: readonly EventRecord[],
  users: readonly UserRecord[],
  window: AnalyticsWindow,
): AnalyticsReport {
  const fromMs = ms(window.from) ?? 0;
  const toMs = ms(window.to) ?? fromMs;
  const bucketMs = window.bucket === 'week' ? WEEK_MS : DAY_MS;
  const span = Math.max(toMs - fromMs, 0);
  const bucketCount = Math.max(Math.ceil(span / bucketMs), 1);

  // idx of a timestamp within [from, to), clamped to the valid bucket range.
  const bucketIndex = (t: number): number | null => {
    if (t < fromMs || t >= toMs) return null;
    return Math.min(Math.floor((t - fromMs) / bucketMs), bucketCount - 1);
  };

  const series: TrendBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    start: new Date(fromMs + i * bucketMs).toISOString(),
    signups: 0,
    activeUsers: 0,
    contestsCreated: 0,
    documentsGenerated: 0,
    errors: 0,
  }));

  // Distinct active users per bucket (for activeUsers series + retention).
  const activePerBucket: Array<Set<string>> = series.map(() => new Set());
  const volume = new Map<string, number>();
  const didCreate = new Set<string>();
  const didGenerate = new Set<string>();
  const didExport = new Set<string>();

  for (const e of events) {
    const idx = bucketIndex(ms(e.occurredAt) ?? NaN);
    if (idx === null) continue;
    volume.set(e.type, (volume.get(e.type) ?? 0) + 1);
    activePerBucket[idx].add(e.userId);
    const bucket = series[idx];
    switch (e.type) {
      case CONTEST_CREATED:
        bucket.contestsCreated++;
        didCreate.add(e.userId);
        break;
      case DOCUMENTS_GENERATED:
        bucket.documentsGenerated++;
        didGenerate.add(e.userId);
        break;
      case CONTEST_EXPORTED:
        didExport.add(e.userId);
        break;
      case CLIENT_ERROR:
        bucket.errors++;
        break;
    }
  }

  // Signups: accounts whose createdAt lands in-window, bucketed by creation.
  for (const u of users) {
    const idx = bucketIndex(ms(u.createdAt) ?? NaN);
    if (idx === null) continue;
    series[idx].signups++;
  }

  series.forEach((b, i) => {
    b.activeUsers = activePerBucket[i].size;
  });

  // Retention: distinct active across the window, and those active in >=2 buckets.
  const bucketsByUser = new Map<string, number>();
  for (const set of activePerBucket) {
    for (const uid of set) bucketsByUser.set(uid, (bucketsByUser.get(uid) ?? 0) + 1);
  }
  const activeUsers = bucketsByUser.size;
  let returningUsers = 0;
  for (const n of bucketsByUser.values()) if (n >= 2) returningUsers++;

  const totalUsers = users.length;
  const ratio = (n: number): AdoptionRatio => ({
    users: n,
    ratio: totalUsers === 0 ? 0 : n / totalUsers,
  });

  const totals = series.reduce(
    (acc, b) => ({
      signups: acc.signups + b.signups,
      activeUsers: acc.activeUsers, // filled below (distinct, not summable)
      contestsCreated: acc.contestsCreated + b.contestsCreated,
      documentsGenerated: acc.documentsGenerated + b.documentsGenerated,
      errors: acc.errors + b.errors,
    }),
    { signups: 0, activeUsers: 0, contestsCreated: 0, documentsGenerated: 0, errors: 0 },
  );
  totals.activeUsers = activeUsers;

  const volumeByType = [...volume.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return {
    window,
    series,
    totals,
    adoption: {
      totalUsers,
      createdContest: ratio(didCreate.size),
      generatedDocuments: ratio(didGenerate.size),
      exported: ratio(didExport.size),
    },
    retention: { activeUsers, returningUsers },
    volumeByType,
  };
}
