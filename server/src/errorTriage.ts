/**
 * Error triage over the activity log — a PURE module (no I/O). The admin errors
 * route fetches the `client.error` events in a window and hands them here; this
 * fingerprints each message into a stable key and groups occurrences so one bug
 * hitting fifty people reads as one row, not fifty.
 *
 * It is strictly READ-ONLY: there is no "resolved"/"ignored" state, so nothing
 * is stored — the groups are recomputed from the log on every read. Drill-down
 * to individual occurrences is the admin feed filtered by `type=client.error`.
 *
 * Depends only on the record shape, so it unit-tests in isolation like the
 * contest model / critique.ts pure suites.
 */
import type { EventRecord } from './eventLog';

/** A fingerprinted group of client-error occurrences. */
export interface ErrorGroup {
  /** The normalized key the group collapses to (volatile bits stripped). */
  fingerprint: string;
  /** A representative RAW message (from the most recent occurrence). */
  sampleMessage: string;
  count: number;
  /** ISO instant of the earliest occurrence. */
  firstSeen: string;
  /** ISO instant of the most recent occurrence. */
  lastSeen: string;
  /** Distinct users who hit this error. */
  affectedUsers: number;
  /** App version of the most recent occurrence, if the client reported one. */
  latestAppVersion?: string;
}

/**
 * Normalizes a client-error message into a stable fingerprint by stripping the
 * volatile bits that differ between instances of the same bug — URLs, UUIDs, hex
 * blobs, numbers, and quoted values — then lowercasing and collapsing
 * whitespace. Two occurrences of the same bug collapse to one key; genuinely
 * different messages stay apart.
 */
export function fingerprint(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/blob:\S+/g, '<url>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/0x[0-9a-f]+/g, '<hex>')
    // No word boundaries: a number glued to a unit ("12s", "30.5s") must still
    // fully collapse, and so must one glued to an identifier ("contest123").
    .replace(/\d+(?:\.\d+)?/g, '<n>')
    .replace(/["'`][^"'`]*["'`]/g, '<str>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls the message + app version out of a client-error event's `detail`. */
function readError(e: EventRecord): { message: string; appVersion?: string } {
  const d = e.detail;
  if (d && typeof d === 'object') {
    const rec = d as Record<string, unknown>;
    return {
      message: typeof rec.message === 'string' ? rec.message : '',
      appVersion: typeof rec.appVersion === 'string' ? rec.appVersion : undefined,
    };
  }
  return { message: typeof d === 'string' ? d : '' };
}

interface GroupAccumulator {
  fingerprint: string;
  sampleMessage: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  users: Set<string>;
  latestAppVersion?: string;
}

/**
 * Groups client-error events by message fingerprint. Each group carries its
 * count, first/last-seen bounds, distinct affected-user count, and the message +
 * app version of its most recent occurrence. Groups are returned most-recent
 * first (ties broken by count), so a fresh spike surfaces at the top.
 */
export function groupErrors(events: readonly EventRecord[]): ErrorGroup[] {
  const groups = new Map<string, GroupAccumulator>();
  for (const e of events) {
    const { message, appVersion } = readError(e);
    const fp = fingerprint(message);
    let g = groups.get(fp);
    if (!g) {
      g = {
        fingerprint: fp,
        sampleMessage: message,
        count: 0,
        firstSeen: e.occurredAt,
        lastSeen: e.occurredAt,
        users: new Set(),
        latestAppVersion: appVersion,
      };
      groups.set(fp, g);
    }
    g.count++;
    g.users.add(e.userId);
    if (e.occurredAt < g.firstSeen) g.firstSeen = e.occurredAt;
    if (e.occurredAt > g.lastSeen) {
      g.lastSeen = e.occurredAt;
      g.sampleMessage = message;
      g.latestAppVersion = appVersion;
    }
  }
  return [...groups.values()]
    .map((g) => ({
      fingerprint: g.fingerprint,
      sampleMessage: g.sampleMessage,
      count: g.count,
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
      affectedUsers: g.users.size,
      ...(g.latestAppVersion !== undefined ? { latestAppVersion: g.latestAppVersion } : {}),
    }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : b.count - a.count));
}
