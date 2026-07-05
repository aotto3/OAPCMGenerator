/**
 * Contest model — the single source of truth for what "a contest" is.
 *
 * PURE MODULE. No React, no DOM, no IndexedDB, no fetch. Everything here is
 * plain data in → plain data out, so it runs identically in the UI, the
 * storage layer, tests, and (later) the sync layer and server. If you need a
 * browser API, you are in the wrong module.
 *
 * Behavior spec: the v12 single-file app (_Templates/OAP Contest Setup.html).
 * Derived-name formats below reproduce v12's updateContestName() and
 * _buildVars() exactly — do not "improve" them; generated documents and
 * folder names depend on these strings.
 */

export const CONTEST_SCHEMA_VERSION = 1;

export const CONTEST_LEVELS = ['Zone', 'District', 'BiDistrict', 'Area', 'Region'] as const;
export type ContestLevel = (typeof CONTEST_LEVELS)[number];

export const CLASSIFICATIONS = ['1A', '2A', '3A', '4A', '5A', '6A'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** Contest Identity — the "Upon Appointment" fields (v12 sec-t1). */
export interface ContestIdentity {
  /** e.g. "2026". Kept as a string, as in v12 (free-text input). */
  contestYear: string;
  contestLevel: ContestLevel;
  classification: Classification;
  /** District / Zone / Area number, e.g. "20". Free text; may be empty. */
  districtNumber: string;
  hostSchoolName: string;
  hostVenueName: string;
  hostAddress: string;
}

export interface Contest {
  /** Stable unique id; never changes after creation. */
  id: string;
  /** ISO 8601 timestamps. updatedAt is bumped by touchContest() on every edit. */
  createdAt: string;
  updatedAt: string;
  identity: ContestIdentity;
  // Later slices add: details, adjudicators, schools, plays, documents, …
  // Device-only fields (Speechwire credentials) will be marked in the schema
  // and excluded from serialization by construction — see PRD issue #13.
}

export interface NewContestOptions {
  id?: string;
  /** ISO timestamp for createdAt/updatedAt; defaults to now. */
  now?: string;
  identity?: Partial<ContestIdentity>;
}

/** Defaults mirror v12's initial form state (year prefilled, District, 5A). */
export function createContest(options: NewContestOptions = {}): Contest {
  const now = options.now ?? new Date().toISOString();
  return {
    id: options.id ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    identity: {
      contestYear: String(new Date(now).getFullYear()),
      contestLevel: 'District',
      classification: '5A',
      districtNumber: '',
      hostSchoolName: '',
      hostVenueName: '',
      hostAddress: '',
      ...options.identity,
    },
  };
}

/** Returns a copy with new identity values and a bumped updatedAt. */
export function withIdentity(
  contest: Contest,
  patch: Partial<ContestIdentity>,
  now: string = new Date().toISOString(),
): Contest {
  return {
    ...contest,
    identity: { ...contest.identity, ...patch },
    updatedAt: now,
  };
}

/** "District 20" / "Zone" — level plus number when a number is present. */
function levelWithNumber(identity: ContestIdentity): string {
  const num = identity.districtNumber.trim();
  return identity.contestLevel + (num ? ' ' + num : '');
}

/**
 * Dashboard / ZIP-folder name, e.g. "2026 — 5A District 20 OAP" (em-dash).
 * v12: folderName in _buildVars(); also the format the PRD dashboard shows.
 */
export function contestDisplayName(identity: ContestIdentity): string {
  return `${identity.contestYear.trim()} — ${identity.classification} ${levelWithNumber(identity)} OAP`;
}

/**
 * The copyable "Contest Name Preview", e.g. "2026 — 5A — District 20 — OAP".
 * v12: updateContestName(). Empty segments are dropped (empty year ⇒
 * "5A — District 20 — OAP"), exactly as v12's .filter(Boolean) did.
 */
export function contestNamePreview(identity: ContestIdentity): string {
  return [identity.contestYear.trim(), identity.classification, levelWithNumber(identity), 'OAP']
    .filter(Boolean)
    .join(' — ');
}

/** e.g. "UIL 5A District 20 One-Act Play Contest". v12: contest_full_name. */
export function contestFullName(identity: ContestIdentity): string {
  return `UIL ${identity.classification} ${levelWithNumber(identity)} One-Act Play Contest`;
}

/** e.g. "2026 UIL 5A District 20 One-Act Play Contest". v12: contest_title_long. */
export function contestTitleLong(identity: ContestIdentity): string {
  return `${identity.contestYear.trim()} ${contestFullName(identity)}`;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * Validation is advisory (v12 warned but never blocked); callers decide
 * whether an issue prevents anything. Empty array ⇒ valid.
 */
export function validateContest(contest: Contest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { identity } = contest;
  if (!identity.contestYear.trim()) {
    issues.push({ field: 'contestYear', message: 'Contest year is blank.' });
  } else if (!/^\d{4}$/.test(identity.contestYear.trim())) {
    issues.push({ field: 'contestYear', message: 'Contest year should be a 4-digit year, e.g. 2026.' });
  }
  if (!(CONTEST_LEVELS as readonly string[]).includes(identity.contestLevel)) {
    issues.push({ field: 'contestLevel', message: `Contest level must be one of: ${CONTEST_LEVELS.join(', ')}.` });
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(identity.classification)) {
    issues.push({ field: 'classification', message: `Classification must be one of: ${CLASSIFICATIONS.join(', ')}.` });
  }
  return issues;
}

/* ────────────────────────── serialization ──────────────────────────
 * Every contest that leaves memory (IndexedDB, sync, contest-file export)
 * travels as this versioned envelope. parseContest() applies forward
 * migrations so old payloads always load; add a migration step here whenever
 * CONTEST_SCHEMA_VERSION is bumped. Never mutate old migration steps.
 */

interface ContestEnvelope {
  schemaVersion: number;
  contest: Contest;
}

export function serializeContest(contest: Contest): string {
  const envelope: ContestEnvelope = { schemaVersion: CONTEST_SCHEMA_VERSION, contest };
  return JSON.stringify(envelope);
}

/**
 * Forward migrations, keyed by the version they migrate FROM.
 * Example for a future bump to version 2:
 *   1: (raw) => ({ ...raw, details: defaultDetails() }),
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export function parseContest(json: string): Contest {
  let envelope: unknown;
  try {
    envelope = JSON.parse(json);
  } catch {
    throw new Error('Contest data is not valid JSON.');
  }
  if (typeof envelope !== 'object' || envelope === null) {
    throw new Error('Contest data is not an object.');
  }
  const { schemaVersion, contest } = envelope as Partial<ContestEnvelope>;
  if (typeof schemaVersion !== 'number') {
    throw new Error('Contest data has no schemaVersion.');
  }
  if (schemaVersion > CONTEST_SCHEMA_VERSION) {
    throw new Error(
      `Contest data is schema version ${schemaVersion}, newer than this app understands (${CONTEST_SCHEMA_VERSION}). Update the app.`,
    );
  }
  let raw = contest as Record<string, unknown> | undefined;
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Contest data has no contest record.');
  }
  for (let v = schemaVersion; v < CONTEST_SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new Error(`No migration from contest schema version ${v}.`);
    raw = migrate(raw);
  }
  const c = raw as unknown as Contest;
  if (typeof c.id !== 'string' || typeof c.identity !== 'object' || c.identity === null) {
    throw new Error('Contest record is malformed.');
  }
  return c;
}
