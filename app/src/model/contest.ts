/**
 * Contest model — the single source of truth for what "a contest" is.
 *
 * PURE MODULE. No React, no DOM, no IndexedDB, no fetch. Everything here is
 * plain data in → plain data out, so it runs identically in the UI, the
 * storage layer, tests, and (later) the sync layer and server. If you need a
 * browser API, you are in the wrong module.
 *
 * Behavior spec: the v12 single-file app (_Templates/OAP Contest Setup.html).
 * Derived-name formats, deadline math, rehearsal day-split logic, and the
 * document list below reproduce v12 exactly — do not "improve" them;
 * generated documents and folder names depend on these values.
 *
 * Device-only fields: `speechwire` never leaves the device. serializeContest
 * strips it by construction, so the sync layer and the contest-file export
 * cannot leak credentials even by accident. The local store persists it
 * separately (see storage/contestStore.ts).
 */

export const CONTEST_SCHEMA_VERSION = 3;

export const CONTEST_LEVELS = ['Zone', 'District', 'BiDistrict', 'Area', 'Region'] as const;
export type ContestLevel = (typeof CONTEST_LEVELS)[number];

export const CLASSIFICATIONS = ['1A', '2A', '3A', '4A', '5A', '6A'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CRITIQUE_FORMATS = ['after_each', 'after_all'] as const;
export type CritiqueFormat = (typeof CRITIQUE_FORMATS)[number];

/* v12 APP constants. */
export const MIN_SCHOOLS = 3;
export const MAX_SCHOOLS = 8;
export const DEFAULT_SCHOOLS = 6;
export const MAX_JUDGES = 3;
export const DEFAULT_JUDGES = 3;
export const REHEARSAL_LENGTH_OPTIONS = [45, 60, 90, 120] as const;
export const HOTEL_NIGHTS_OPTIONS = [1, 2, 3] as const;

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

/** Contest Manager info (v12 sec-cm). */
export interface CmInfo {
  name: string;
  email: string;
  phone: string;
  /** Mailing address used in letter closings. */
  mailingAddress: string;
  /** Optional. */
  website: string;
  /** Lighting tech contact at the host school. Docs fall back to a placeholder. */
  techContact: string;
}

/** Contest Details — the "After Planning Meeting" fields (v12 sec-t2). */
export interface ContestDetails {
  /** ISO date (yyyy-mm-dd) or ''. */
  contestDate: string;
  /** Free-text time, e.g. "10:00 AM". */
  directorsMeetingTime: string;
  /** Free-text time, e.g. "11:00 AM". */
  firstShowTime: string;
  critiqueFormat: CritiqueFormat;
  /** 1–3. Judges beyond this count keep their data but are inactive (v12). */
  numJudges: number;
  rehearsalDate1: string;
  /** Optional second rehearsal day; day-2 fields apply only when set. */
  rehearsalDate2: string;
  rehearsalStartTime1: string;
  rehearsalStartTime2: string;
  /**
   * Schools rehearsing on day 1 when there are two rehearsal days.
   * null ⇒ v12's default split, floor(numSchools / 2) — see rehearsalDay1Count().
   */
  rehearsalDay1Count: number | null;
  rehearsalLengthMinutes: number;
  /** Raw dollar amount as typed, e.g. "50". '' ⇒ no entry fee. */
  entryFee: string;
  /** Raw dollar amount as typed. '' ⇒ no admission charge. */
  admissionFee: string;
  entrySystemDeadline: string;
  lightCueDeadlineDate: string;
  lightCueDeadlineTime: string;
  /** Date of the advancing BiDistrict contest; only relevant at BiDistrict level. */
  bidcContestDate: string;
}

/** One adjudicator (v12 sec-t3 judge_N_* fields). Contest always stores MAX_JUDGES. */
export interface Adjudicator {
  name: string;
  /** Shared with directors for script submission. */
  mailingAddress: string;
  needsPower: boolean;
  needsHotel: boolean;
  /** 1–3; only meaningful when needsHotel. */
  hotelNights: number;
  /** Dietary / other requests, free text. */
  dietary: string;
}

export interface Director {
  name: string;
  email: string;
}

/** One competing school (v12 school_N_* + play_N_* fields). */
export interface School {
  name: string;
  /** Always at least one row, as in v12. */
  directors: Director[];
  playTitle: string;
  /** 1-based slot from the blind draw. Defaults to the school's position. */
  performanceOrder: number;
}

/**
 * Documents to Generate — v12 checkbox list, in UI order. The document engine
 * (later slice) registers build functions against these same ids.
 */
export const DOCUMENT_TYPES = [
  { id: 'checklist', label: 'Year-Round Checklist (.xlsx)', defaultSelected: true },
  { id: 'fall_agenda', label: 'Fall District Meeting Agenda (.docx)', defaultSelected: true },
  { id: 'host_checklist', label: 'Host School Checklist (.docx)', defaultSelected: true },
  { id: 'rehearsal', label: 'Schedule - Reh. and Contest (.xlsx)', defaultSelected: true },
  { id: 'schedule', label: 'Contest Day Schedule (.xlsx)', defaultSelected: true },
  { id: 'letter', label: 'Director Information Letter (.docx)', defaultSelected: true },
  { id: 'pre_rehearsal_meeting', label: 'Pre-Rehearsal Company Meeting (.docx)', defaultSelected: true },
  { id: 'directors_meeting', label: 'Directors Meeting Script (.docx)', defaultSelected: true },
  { id: 'awards', label: 'Awards Script (.docx)', defaultSelected: true },
  { id: 'advancing_letter', label: 'Advancing Schools Letter (.docx)', defaultSelected: true },
  { id: 'contacts', label: 'School-Director Contact List (.xlsx)', defaultSelected: true },
  { id: 'adjudicator', label: 'Adjudicator Info Sheet (.xlsx)', defaultSelected: true },
  // Slow PDF generation — only wanted once judges are contracted (v12).
  { id: 'adj_packets', label: 'Adjudicator Packets (.pdf)', defaultSelected: false },
  { id: 'timer', label: 'Timer Instructions + Form (.docx)', defaultSelected: false },
] as const;

export type DocumentId = (typeof DOCUMENT_TYPES)[number]['id'];
export type DocumentSelection = Record<DocumentId, boolean>;

/**
 * DEVICE-ONLY. Per-contest Speechwire credentials from the state theatre
 * director. Never serialized, never synced, never exported (PRD issue #13).
 */
export interface SpeechwireCredentials {
  username: string;
  password: string;
}

/**
 * Locked-in critique assignment (v12 _critiqueAssignments/_critiqueLocked).
 *
 * Stored IN the contest record so it autosaves, syncs, and exports like every
 * other field — no separate serialization. The randomizer's output is the ONE
 * thing that persists: `judgeByPosition[k]` is the 1-based judge number assigned
 * to the school in performance-order position k (0-based), so its length equals
 * the school count at generation time. School names, plays, and judge names are
 * NOT copied here — they are re-derived from the contest at read time (see
 * critiqueRows in documents/docVars.ts), so a later name edit is reflected
 * without regenerating.
 *
 * `null` on Contest ⇒ no assignment generated yet. `locked` freezes the result:
 * v12 only persisted and consumed locked assignments, and only locked ones flow
 * into generated documents.
 */
export interface CritiqueAssignment {
  /** 1-based judge number per performance-order position (0-based index). */
  judgeByPosition: number[];
  /** Frozen once locked (v12 _critiqueLocked); reorder is disabled while true. */
  locked: boolean;
}

export interface Contest {
  /** Stable unique id; never changes after creation. */
  id: string;
  /** ISO 8601 timestamps. updatedAt is bumped by every update helper. */
  createdAt: string;
  updatedAt: string;
  identity: ContestIdentity;
  cmInfo: CmInfo;
  details: ContestDetails;
  /** Always MAX_JUDGES entries; details.numJudges says how many are active. */
  adjudicators: Adjudicator[];
  /** Length is the "Number of Schools" (MIN_SCHOOLS–MAX_SCHOOLS). Form order. */
  schools: School[];
  documents: DocumentSelection;
  /** Randomized critique-to-judge assignment; null until first generated. */
  critique: CritiqueAssignment | null;
  /** Device-only — excluded from serializeContest() by construction. */
  speechwire: SpeechwireCredentials;
}

/* ────────────────────────── defaults ────────────────────────── */

/**
 * v12 pre-fills the CM section with the author's info (input value=""
 * attributes). Mirrored here for behavior parity; the auth slice will
 * replace this with the signed-in account's info.
 */
export function defaultCmInfo(): CmInfo {
  return {
    name: 'Allen Otto',
    email: 'aotto3@gmail.com',
    phone: '281-777-8672',
    mailingAddress: '8010 Sharpcrest Street, Houston, TX 77036',
    website: 'www.allenotto.com',
    techContact: '',
  };
}

export function defaultDetails(): ContestDetails {
  return {
    contestDate: '',
    directorsMeetingTime: '',
    firstShowTime: '',
    critiqueFormat: 'after_all',
    numJudges: DEFAULT_JUDGES,
    rehearsalDate1: '',
    rehearsalDate2: '',
    rehearsalStartTime1: '2:00 PM',
    rehearsalStartTime2: '2:00 PM',
    rehearsalDay1Count: null,
    rehearsalLengthMinutes: 90,
    entryFee: '',
    admissionFee: '',
    entrySystemDeadline: '',
    lightCueDeadlineDate: '',
    lightCueDeadlineTime: '5:00 PM',
    bidcContestDate: '',
  };
}

function blankAdjudicator(): Adjudicator {
  return { name: '', mailingAddress: '', needsPower: false, needsHotel: false, hotelNights: 1, dietary: '' };
}

export function defaultAdjudicators(): Adjudicator[] {
  return Array.from({ length: MAX_JUDGES }, blankAdjudicator);
}

function blankSchool(position: number): School {
  return { name: '', directors: [{ name: '', email: '' }], playTitle: '', performanceOrder: position };
}

export function defaultSchools(count: number = DEFAULT_SCHOOLS): School[] {
  return Array.from({ length: count }, (_, i) => blankSchool(i + 1));
}

export function defaultDocumentSelection(): DocumentSelection {
  const selection = {} as DocumentSelection;
  for (const doc of DOCUMENT_TYPES) selection[doc.id] = doc.defaultSelected;
  return selection;
}

export function defaultSpeechwire(): SpeechwireCredentials {
  return { username: '', password: '' };
}

export interface NewContestOptions {
  id?: string;
  /** ISO timestamp for createdAt/updatedAt; defaults to now. */
  now?: string;
  identity?: Partial<ContestIdentity>;
}

/** Defaults mirror v12's initial form state (year prefilled, District, 5A, 6 schools, 3 judges). */
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
    cmInfo: defaultCmInfo(),
    details: defaultDetails(),
    adjudicators: defaultAdjudicators(),
    schools: defaultSchools(),
    documents: defaultDocumentSelection(),
    critique: null,
    speechwire: defaultSpeechwire(),
  };
}

/* ────────────────── creating a contest from an existing one ──────────────────
 * Two ways a contest enters the account as a NEW record — importing a contest
 * file and duplicating (roll-forward). Both are pure so their id/timestamp
 * handling and, for duplicate, the field policy are unit-testable; the UI only
 * picks the file and persists the result (ui/Dashboard.tsx).
 */

export interface NewFromExistingOptions {
  id?: string;
  /** ISO timestamp for createdAt/updatedAt; defaults to now. */
  now?: string;
}

/**
 * Imports a contest file — the versioned JSON serializeContest() writes into
 * every generated ZIP — as a NEW contest. parseContest does the real work
 * (JSON parse, forward migration, friendly-error rejection, device-only
 * rehydration); this wrapper only stamps a fresh id and timestamps so the
 * import never collides with or overwrites an existing contest. Device-only
 * Speechwire fields are never in the file and arrive blank.
 */
export function importContest(json: string, options: NewFromExistingOptions = {}): Contest {
  const now = options.now ?? new Date().toISOString();
  return { ...parseContest(json), id: options.id ?? crypto.randomUUID(), createdAt: now, updatedAt: now };
}

/**
 * Per-season detail fields a roll-forward duplicate CLEARS — the dates,
 * deadlines, and meeting/show times that belong to a single contest occurrence.
 * Everything else in ContestDetails (critique format, judge count, rehearsal
 * lengths/start times, fees) is a stable setting and carries forward.
 */
const CLEARED_DETAIL_FIELDS = {
  contestDate: '',
  directorsMeetingTime: '',
  firstShowTime: '',
  rehearsalDate1: '',
  rehearsalDate2: '',
  entrySystemDeadline: '',
  lightCueDeadlineDate: '',
  bidcContestDate: '',
} as const satisfies Partial<ContestDetails>;

/**
 * Duplicates a contest as a roll-forward (PRD user story 5): a new record that
 * KEEPS the stable, year-over-year data — contest identity (level,
 * classification, district, host), CM info, schools and their directors, and
 * document selection — and CLEARS everything tied to one occurrence: contest
 * date, deadlines, meeting/show times, rehearsal dates, judges, play titles,
 * and performance order.
 *
 * The kept set mirrors v12's snapshot scope (OAP_SNAP_FIELDS/OAP_SNAP_SELECTS —
 * the curated fields v12 carried between contests), extended per issue #17 to
 * also clear judges. Pure and total, so the policy lives here and is tested,
 * not buried in the dashboard.
 */
export function duplicateContest(contest: Contest, options: NewFromExistingOptions = {}): Contest {
  const now = options.now ?? new Date().toISOString();
  return {
    ...contest,
    id: options.id ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    // identity + cmInfo + documents carry forward untouched (stable data).
    details: { ...contest.details, ...CLEARED_DETAIL_FIELDS },
    // Judges change every contest — start fresh.
    adjudicators: defaultAdjudicators(),
    // Keep each school and its directors; drop this year's play + draw order.
    schools: contest.schools.map((s, i) => ({
      ...s,
      directors: s.directors.map((d) => ({ ...d })),
      playTitle: '',
      performanceOrder: i + 1,
    })),
    // Judges and the draw both change every contest — drop last year's assignment.
    critique: null,
    // Device-only credentials are per-contest; never carry them across.
    speechwire: defaultSpeechwire(),
  };
}

/* ────────────────────────── update helpers ──────────────────────────
 * All edits go through these: they are immutable and bump updatedAt, which
 * is also what arms autosave (a brand-new contest with updatedAt ===
 * createdAt is an unsaved draft — see storage/useAutosave.ts).
 */

function touch(contest: Contest, now?: string): Contest {
  return { ...contest, updatedAt: now ?? new Date().toISOString() };
}

/** Returns a copy with new identity values and a bumped updatedAt. */
export function withIdentity(contest: Contest, patch: Partial<ContestIdentity>, now?: string): Contest {
  return { ...touch(contest, now), identity: { ...contest.identity, ...patch } };
}

export function withCmInfo(contest: Contest, patch: Partial<CmInfo>, now?: string): Contest {
  return { ...touch(contest, now), cmInfo: { ...contest.cmInfo, ...patch } };
}

/**
 * Patches contest details. Mirrors v12's autoCalcDeadlines(): when the
 * contest date is set, any still-blank entry-system and light-cue deadlines
 * are auto-filled to 10 days before the contest. Explicit values in the
 * patch (or already entered) are never overwritten.
 */
export function withDetails(contest: Contest, patch: Partial<ContestDetails>, now?: string): Contest {
  const details = { ...contest.details, ...patch };
  if ('contestDate' in patch && details.contestDate) {
    const auto = autoDeadlineFor(details.contestDate);
    if (auto) {
      if (!details.entrySystemDeadline) details.entrySystemDeadline = auto;
      if (!details.lightCueDeadlineDate) details.lightCueDeadlineDate = auto;
    }
  }
  return { ...touch(contest, now), details };
}

export function withSpeechwire(contest: Contest, patch: Partial<SpeechwireCredentials>, now?: string): Contest {
  return { ...touch(contest, now), speechwire: { ...contest.speechwire, ...patch } };
}

export function withAdjudicator(
  contest: Contest,
  index: number,
  patch: Partial<Adjudicator>,
  now?: string,
): Contest {
  const adjudicators = contest.adjudicators.map((j, i) => (i === index ? { ...j, ...patch } : j));
  return { ...touch(contest, now), adjudicators };
}

export function withSchool(
  contest: Contest,
  index: number,
  patch: Partial<Omit<School, 'directors'>>,
  now?: string,
): Contest {
  const schools = contest.schools.map((s, i) => (i === index ? { ...s, ...patch } : s));
  return { ...touch(contest, now), schools };
}

export function withDirector(
  contest: Contest,
  schoolIndex: number,
  directorIndex: number,
  patch: Partial<Director>,
  now?: string,
): Contest {
  const schools = contest.schools.map((s, i) =>
    i === schoolIndex
      ? { ...s, directors: s.directors.map((d, di) => (di === directorIndex ? { ...d, ...patch } : d)) }
      : s,
  );
  return { ...touch(contest, now), schools };
}

export function addDirector(contest: Contest, schoolIndex: number, now?: string): Contest {
  const schools = contest.schools.map((s, i) =>
    i === schoolIndex ? { ...s, directors: [...s.directors, { name: '', email: '' }] } : s,
  );
  return { ...touch(contest, now), schools };
}

/** A school always keeps at least one director row (v12 removeDirRow guard). */
export function removeDirector(
  contest: Contest,
  schoolIndex: number,
  directorIndex: number,
  now?: string,
): Contest {
  const school = contest.schools[schoolIndex];
  if (!school || school.directors.length <= 1) return contest;
  const schools = contest.schools.map((s, i) =>
    i === schoolIndex ? { ...s, directors: s.directors.filter((_, di) => di !== directorIndex) } : s,
  );
  return { ...touch(contest, now), schools };
}

/**
 * Resizes the school list (clamped to MIN_SCHOOLS–MAX_SCHOOLS). Like v12's
 * num_schools rebuild: shrinking drops trailing schools, growing appends
 * blank ones with performanceOrder = position.
 */
export function setNumSchools(contest: Contest, count: number, now?: string): Contest {
  const n = Math.min(MAX_SCHOOLS, Math.max(MIN_SCHOOLS, Math.round(count)));
  if (n === contest.schools.length) return touch(contest, now);
  const schools = contest.schools.slice(0, n);
  while (schools.length < n) schools.push(blankSchool(schools.length + 1));
  return { ...touch(contest, now), schools };
}

export function setDocumentSelected(contest: Contest, id: DocumentId, selected: boolean, now?: string): Contest {
  return { ...touch(contest, now), documents: { ...contest.documents, [id]: selected } };
}

/** v12 Check All / Uncheck All. */
export function setAllDocuments(contest: Contest, selected: boolean, now?: string): Contest {
  const documents = {} as DocumentSelection;
  for (const doc of DOCUMENT_TYPES) documents[doc.id] = selected;
  return { ...touch(contest, now), documents };
}

/* ─────────────────────── critique assignment ───────────────────────
 * v12 runCritiqueRandomizer/lock/unlock/moveCritiqueRow operated on the module
 * globals _critiqueAssignments/_critiqueLocked; here the same state lives in the
 * contest record and every edit is an immutable update (so it autosaves). The
 * RANDOMIZATION itself is the pure model/critique.ts algorithm — these helpers
 * only store, freeze, and reorder its result.
 */

/**
 * Stores a freshly generated assignment, UNLOCKED (v12 always re-randomizes into
 * the unlocked state, then the CM locks it). `judgeByPosition` is 1-based judge
 * numbers indexed by performance-order position — normally from
 * generateCritiqueAssignments().
 */
export function setCritiqueAssignment(contest: Contest, judgeByPosition: number[], now?: string): Contest {
  return { ...touch(contest, now), critique: { judgeByPosition: [...judgeByPosition], locked: false } };
}

/** Freezes the current assignment (v12 lockCritiqueAssignment). No-op if none. */
export function lockCritique(contest: Contest, now?: string): Contest {
  if (!contest.critique) return contest;
  return { ...touch(contest, now), critique: { ...contest.critique, locked: true } };
}

/** Unfreezes for re-randomize / reorder (v12 unlockCritiqueAssignment). No-op if none. */
export function unlockCritique(contest: Contest, now?: string): Contest {
  if (!contest.critique) return contest;
  return { ...touch(contest, now), critique: { ...contest.critique, locked: false } };
}

/**
 * Adjacent swap of two schools' judge assignments (v12 moveCritiqueRow): swaps
 * judgeByPosition[index] with judgeByPosition[index + direction]. The school rows
 * stay in performance order — only the judge assignment moves. `direction` is
 * ±1; any other value, an out-of-range target, no assignment, or a LOCKED
 * assignment is a no-op (v12 hides the controls while locked).
 */
export function moveCritiqueAssignment(contest: Contest, index: number, direction: number, now?: string): Contest {
  const critique = contest.critique;
  if (!critique || critique.locked) return contest;
  if (direction !== 1 && direction !== -1) return contest;
  const target = index + direction;
  const judges = critique.judgeByPosition;
  if (index < 0 || index >= judges.length || target < 0 || target >= judges.length) return contest;
  const swapped = [...judges];
  [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
  return { ...touch(contest, now), critique: { ...critique, judgeByPosition: swapped } };
}

/* ────────────────────────── derived values ────────────────────────── */

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
 * Filename of the portable contest file bundled in every generated ZIP, e.g.
 * "2026 — 5A District 20 OAP — Contest File.json". This is the versioned
 * serializeContest() JSON — a backup / handoff that re-imports on any machine,
 * replacing v12's Regenerate.html (PRD issue #13).
 */
export function contestFileName(identity: ContestIdentity): string {
  return `${contestDisplayName(identity)} — Contest File.json`;
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

/** Number of schools is the schools list itself — no second copy to drift. */
export function numSchools(contest: Contest): number {
  return contest.schools.length;
}

/**
 * Deadline default: 10 days before the contest, as an ISO date. Reproduces
 * v12 autoCalcDeadlines() exactly, including its local-noon anchor (which
 * makes the subtraction immune to DST edges). '' in ⇒ '' out.
 */
export function autoDeadlineFor(contestDate: string): string {
  if (!contestDate) return '';
  const d = new Date(contestDate + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() - 10);
  return d.toISOString().substring(0, 10);
}

/**
 * Effective schools-on-day-1 for two-day rehearsals. v12's select defaults
 * to floor(numSchools / 2), min 1; a stored choice wins.
 */
export function rehearsalDay1Count(contest: Contest): number {
  const n = numSchools(contest);
  const stored = contest.details.rehearsalDay1Count;
  const value = stored ?? (Math.floor(n / 2) || 1);
  return Math.min(Math.max(value, 1), n - 1);
}

/** "Day 2 gets the rest" (v12 updateRehearsalDay2Count). */
export function rehearsalDay2Count(contest: Contest): number {
  return numSchools(contest) - rehearsalDay1Count(contest);
}

/** v12: entry_fee derived text — "$50 per school" or "No entry fee". */
export function entryFeeDisplay(details: ContestDetails): string {
  return details.entryFee ? `$${details.entryFee} per school` : 'No entry fee';
}

/** v12: admission_fee derived text — "$10" or "No admission charge". */
export function admissionFeeDisplay(details: ContestDetails): string {
  return details.admissionFee ? `$${details.admissionFee}` : 'No admission charge';
}

/**
 * All director emails, school by school in form order, blank entries
 * skipped — v12 updateEmailList(). Join with ', ' for the copyable box.
 */
export function allDirectorEmails(contest: Contest): string[] {
  return contest.schools.flatMap((s) => s.directors.map((d) => d.email.trim()).filter(Boolean));
}

/**
 * Schools sorted by performance order (stable, so ties keep form order) —
 * what the schedule and documents consume. v12: _readSchools() sort.
 */
export function schoolsInPerformanceOrder(contest: Contest): School[] {
  return [...contest.schools].sort((a, b) => a.performanceOrder - b.performanceOrder);
}

/* ────────────────────────── section completion ──────────────────────────
 * New in 2.0 (PRD user story 12): each data-entry section shows how much of
 * it is filled in. "Expected" fields are the ones every contest eventually
 * needs; genuinely optional fields (website, district number, fees — blank
 * means "none" — and Speechwire credentials) are not counted.
 */

export const SECTION_IDS = ['cm', 'identity', 'details', 'adjudicators', 'schools', 'plays'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface SectionCompletion {
  done: number;
  total: number;
}

export function sectionCompletion(contest: Contest): Record<SectionId, SectionCompletion> {
  const filled = (values: string[]): SectionCompletion => ({
    done: values.filter((v) => v.trim() !== '').length,
    total: values.length,
  });

  const { cmInfo, identity, details } = contest;
  const detailFields = [
    details.contestDate,
    details.directorsMeetingTime,
    details.firstShowTime,
    details.rehearsalDate1,
    details.entrySystemDeadline,
    details.lightCueDeadlineDate,
  ];
  if (identity.contestLevel === 'BiDistrict') detailFields.push(details.bidcContestDate);

  const activeJudges = contest.adjudicators.slice(0, details.numJudges);
  const schoolFields = contest.schools.flatMap((s) => [
    s.name,
    ...s.directors.flatMap((d) => [d.name, d.email]),
  ]);

  return {
    cm: filled([cmInfo.name, cmInfo.email, cmInfo.phone, cmInfo.mailingAddress, cmInfo.techContact]),
    identity: filled([identity.contestYear, identity.hostSchoolName, identity.hostVenueName, identity.hostAddress]),
    details: filled(detailFields),
    adjudicators: filled(activeJudges.flatMap((j) => [j.name, j.mailingAddress])),
    schools: filled(schoolFields),
    plays: filled(contest.schools.map((s) => s.playTitle)),
  };
}

/* ────────────────────────── validation ────────────────────────── */

export interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * Validation is advisory (v12 warned but never blocked); callers decide
 * whether an issue prevents anything. Empty array ⇒ valid. Pre-generation
 * warnings (missing date, duplicate performance order — v12 generateAll)
 * live here too so the generate flow and the live UI agree.
 */
export function validateContest(contest: Contest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { identity, details, schools } = contest;
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
  if (!(CRITIQUE_FORMATS as readonly string[]).includes(details.critiqueFormat)) {
    issues.push({ field: 'critiqueFormat', message: `Critique format must be one of: ${CRITIQUE_FORMATS.join(', ')}.` });
  }
  if (!Number.isInteger(details.numJudges) || details.numJudges < 1 || details.numJudges > MAX_JUDGES) {
    issues.push({ field: 'numJudges', message: `Number of judges must be 1–${MAX_JUDGES}.` });
  }
  if (schools.length < MIN_SCHOOLS || schools.length > MAX_SCHOOLS) {
    issues.push({ field: 'schools', message: `Number of schools must be ${MIN_SCHOOLS}–${MAX_SCHOOLS}.` });
  }
  const orders = schools.map((s) => s.performanceOrder);
  if (new Set(orders).size < orders.length) {
    issues.push({
      field: 'performanceOrder',
      message: 'Two or more schools share the same performance order number — check Play Titles & Order.',
    });
  }
  return issues;
}

/**
 * Pre-generation warnings shown by the Generate flow (v12 generateAll's input
 * validation block). These are the contest-day-readiness checks — a contest can
 * be schema-valid yet not ready to generate — and, like v12, they warn without
 * blocking: the user may proceed anyway. Messages match v12 verbatim so the
 * confirm dialog reads identically. Empty array ⇒ nothing to warn about.
 */
export function generationWarnings(contest: Contest): string[] {
  const { identity, details } = contest;
  const warnings: string[] = [];
  if (!details.contestDate.trim()) warnings.push('Contest Date is not set.');
  if (!identity.hostSchoolName.trim()) warnings.push('Host School Name is blank.');
  const dmt = details.directorsMeetingTime.trim();
  if (!dmt || dmt === 'TBD') warnings.push('Directors Meeting Time is not set.');
  if (!details.firstShowTime.trim()) {
    warnings.push('First Show / Setup Time is not set — Contest Day Schedule will be empty.');
  }
  const orders = contest.schools.map((s) => s.performanceOrder);
  if (new Set(orders).size < orders.length) {
    warnings.push('Two or more schools share the same performance order number — check Play Titles & Order.');
  }
  return warnings;
}

/* ────────────────────────── serialization ──────────────────────────
 * Every contest that leaves memory (IndexedDB, sync, contest-file export)
 * travels as this versioned envelope. parseContest() applies forward
 * migrations so old payloads always load; add a migration step here whenever
 * CONTEST_SCHEMA_VERSION is bumped. Never mutate old migration steps.
 *
 * Device-only fields are stripped here, at the model boundary — no caller
 * can serialize credentials, so no sync or export path can leak them.
 */

interface ContestEnvelope {
  schemaVersion: number;
  contest: Contest;
}

export function serializeContest(contest: Contest): string {
  const { speechwire: _deviceOnly, ...syncable } = contest;
  const envelope = { schemaVersion: CONTEST_SCHEMA_VERSION, contest: syncable };
  return JSON.stringify(envelope);
}

/**
 * Forward migrations, keyed by the version they migrate FROM.
 * v1 (Slice 1) contests had only id/timestamps/identity.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  1: (raw) => ({
    ...raw,
    cmInfo: defaultCmInfo(),
    details: defaultDetails(),
    adjudicators: defaultAdjudicators(),
    schools: defaultSchools(),
    documents: defaultDocumentSelection(),
  }),
  // v2 (Slices 2–9) had no critique assignment — start with none.
  2: (raw) => ({ ...raw, critique: null }),
};

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
  // Device-only fields are never in the payload; hydrate with blanks. The
  // local store re-attaches this device's values (storage/contestStore.ts).
  return { ...c, speechwire: defaultSpeechwire() };
}
