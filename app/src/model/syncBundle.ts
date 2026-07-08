/**
 * Sync bundle — the wire format the background sync layer sends to the server,
 * and the ONLY thing that leaves this device on the sync path.
 *
 * PURE MODULE. No React, no DOM, no IndexedDB, no fetch — like the rest of
 * model/. A bundle is a contest PLUS its checkpoints, because Slice 14 folds
 * checkpoints into the opaque payload the server already stores (issue #27):
 *
 *   { schemaVersion, contest, checkpoints }
 *
 * That is a superset of serializeContest()'s `{ schemaVersion, contest }`
 * envelope, so the server's existing opaque validation accepts it unchanged
 * (it checks only that `contest` is present and carries no `speechwire`, and
 * ignores extra keys) — no new table, endpoint, or API redeploy.
 *
 * Device-only guarantee: the bundle is built from serializeContest() output,
 * which strips `speechwire` by construction, and each checkpoint's payload is
 * itself a serializeContest() envelope. So no code path here can put Speechwire
 * credentials on the wire — see syncBundle.test.ts, which asserts this against
 * the serialized bytes.
 */
import type { Checkpoint } from './checkpoint';
import {
  CONTEST_SCHEMA_VERSION,
  parseContest,
  serializeContest,
  type Contest,
} from './contest';

export interface SyncBundle {
  contest: Contest;
  checkpoints: Checkpoint[];
}

/**
 * Wraps an ALREADY-serialized contest envelope (exactly what serializeContest
 * produced and what the local store holds in `payload`) together with its
 * checkpoints, without re-serializing the contest. Working from the stored
 * envelope bytes means the device-only stripping serializeContest did is
 * inherited verbatim — this function never touches the live Contest.
 */
export function bundleFromEnvelope(contestEnvelope: string, checkpoints: Checkpoint[]): string {
  const envelope = JSON.parse(contestEnvelope) as Record<string, unknown>;
  return JSON.stringify({ ...envelope, checkpoints });
}

/** Serializes a live contest and its checkpoints into a sync bundle. */
export function serializeSyncBundle(contest: Contest, checkpoints: Checkpoint[]): string {
  return bundleFromEnvelope(serializeContest(contest), checkpoints);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCheckpoint(value: unknown): value is Checkpoint {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.contestId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.note === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.payload === 'string'
  );
}

/**
 * Parses a sync bundle back into a contest and its checkpoints. The contest is
 * routed through parseContest so it forward-migrates and rehydrates device-only
 * fields blank exactly like every other stored copy; checkpoints are validated
 * structurally and malformed ones are dropped defensively (their own payloads
 * migrate later, on restore). Throws on non-JSON or a missing contest.
 */
export function parseSyncBundle(json: string): SyncBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Sync bundle is not valid JSON.');
  }
  if (!isPlainObject(parsed)) {
    throw new Error('Sync bundle is not an object.');
  }
  const { checkpoints, ...envelope } = parsed;
  const contest = parseContest(JSON.stringify(envelope));
  const list = Array.isArray(checkpoints) ? checkpoints.filter(isCheckpoint) : [];
  return { contest, checkpoints: list };
}

/** The schema version stamped on a freshly built bundle (mirrors the contest). */
export const SYNC_BUNDLE_SCHEMA_VERSION = CONTEST_SCHEMA_VERSION;
