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

export const CONTEST_SCHEMA_VERSION = 9;

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
  /** Optional free-text bio printed on the Audience Program front matter (PRD #68). */
  bio: string;
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
  /* ── contracting milestones (PRD #67) ──
   * Each is a nullable ISO-date ('YYYY-MM-DD'). The DATE is the record: '' ⇒
   * not done, a date ⇒ done on that date. No separate boolean; "done" is derived
   * from date presence (adjudicatorMilestoneStatus). Excluded from
   * sectionCompletion. */
  /** TTAO adjudication contract signed/on file. */
  ttaoContractDate: string;
  /** Payment paperwork (W-9 / vendor forms) sent to the judge. */
  paymentPaperworkSentDate: string;
  /** Payment paperwork received back from the judge. */
  paymentPaperworkReturnedDate: string;
  /** Optional free-text bio printed on the Audience Program front matter (PRD #68). */
  bio: string;
}

export interface Director {
  name: string;
  email: string;
}

/* ────────────────────────── compliance items ──────────────────────────
 * PRD #64. The per-school paperwork checklist. Both built-in and custom items
 * are just { id, label }; a school's status for an item is looked up by id, so
 * status travels with the school (not its list position). Absent ⇒ 'pending'.
 */

export const COMPLIANCE_STATUSES = ['pending', 'received', 'na'] as const;
/** Tri-state per (school, item). Absent from a school's map ⇒ 'pending'. */
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/** A compliance checklist item — built-in or custom; both are just id + label. */
export interface ComplianceItem {
  id: string;
  label: string;
}

/**
 * The fixed handbook compliance items (2025–26 UIL OAP Handbook, PRD #64).
 * Built-ins are never editable or removable — conditionality (a cut script,
 * an off-list title, special scenery) is expressed per-school with an 'na'
 * status, not by hiding items. The `id`s are stable keys stored in every
 * school's status map: never rename or renumber them, only append. If a future
 * handbook drops an item, removing it here simply orphans that item's stored
 * statuses (they stop being referenced), which is harmless.
 */
export const BUILT_IN_COMPLIANCE_ITEMS: readonly ComplianceItem[] = [
  { id: 'community_standards', label: 'Community Standards & Copyright Compliance form (signed)' },
  { id: 'performance_license', label: 'Performance license from publisher' },
  { id: 'royalty_payment', label: 'Written proof of royalty payment' },
  { id: 'cutting_permission', label: '"Scenes from" / cutting permission' },
  { id: 'play_approval', label: 'Play approval (off-list titles)' },
  { id: 'scenic_approval', label: 'Scenic approval' },
  { id: 'online_entry', label: 'Contestant entry in the Online Entry System' },
  { id: 'title_registration', label: 'Title registration' },
] as const;

/* ────────────────────────── readiness checklist ──────────────────────────
 * PRD #75. The contest-lifecycle readiness page. This module owns only the
 * PERSISTED state — the manual/custom check-off status map and the custom-item
 * definitions — plus the fixed built-in manual list and the phase vocabulary.
 * The report that composes derived + manual + custom items into phases with a
 * rollup is the pure `readinessReport` module (G2, sibling of critique.ts),
 * NOT here. Fully additive: an untouched checklist is `{}` + `[]` and costs
 * nothing serialized, exactly like the compliance tracker (PRD #64).
 */

/**
 * The seven chronological contest phases, in order — the lifecycle spine the
 * readiness page groups items into. The first four match the workspace nav
 * strip's phase ids (ui/WorkspaceNav.tsx); G extends it end to end. Every
 * built-in and custom readiness item names one of these as its phase.
 */
export const READINESS_PHASES = [
  'preliminary',
  'planning',
  'contracting',
  'entry',
  'draw_schedule',
  'contest_day',
  'results_advancement',
] as const;
/** One of the seven lifecycle phases a readiness item belongs to. */
export type ReadinessPhase = (typeof READINESS_PHASES)[number];

export const READINESS_STATUSES = ['pending', 'done', 'na'] as const;
/** Tri-state per manual/custom item. Absent from the check-off map ⇒ 'pending'. */
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

/**
 * A manual readiness item — built-in or custom. Both are `{ id, label, phase }`;
 * the check-off status is looked up by id (in the contest's readinessChecks map),
 * so it travels with the item, not its list position (PRD user story 24).
 */
export interface ReadinessItemDef {
  id: string;
  label: string;
  phase: ReadinessPhase;
}

/**
 * The fixed built-in manual logistics items — the real-world tasks the app can't
 * derive from contest data (2025–26 UIL OAP Handbook, PRD #75). Built-ins are
 * never editable or removable; a task that doesn't apply is expressed with an 'na'
 * status, not by hiding it. The `id`s are stable keys stored in the check-off map:
 * never rename or renumber them, only append. This list is the single place to
 * update when the handbook's logistics change (PRD user story 27).
 */
export const BUILT_IN_READINESS_ITEMS: readonly ReadinessItemDef[] = [
  { id: 'venue_reserved', label: 'Venue reserved', phase: 'planning' },
  { id: 'hospitality_arranged', label: 'Hospitality arranged', phase: 'planning' },
  { id: 'trophies_ordered', label: 'Trophies / medals ordered', phase: 'entry' },
  { id: 'programs_printed', label: 'Programs printed', phase: 'draw_schedule' },
  { id: 'tech_set', label: 'Tech / lighting / sound set', phase: 'contest_day' },
] as const;

/* ────────────────────────── company roster ──────────────────────────
 * PRD #68. The competing company's students — its cast, crew, and alternates —
 * captured once (ideally by pasting the director-submitted block, parsed by E2's
 * parseCompanyBlock) and printed on the Audience Program (E5). Additive and
 * blank-safe: a school with no roster behaves exactly as before.
 */

export const ROSTER_CATEGORIES = ['cast', 'crew', 'alternate'] as const;
/** Cast (characters), Crew (positions), or Alternate — how the program groups a member. */
export type RosterCategory = (typeof ROSTER_CATEGORIES)[number];

/**
 * One company member: a student `name`, a free-text `role` (the character for
 * cast, the job for crew, blank for alternates), and a `category`. Ordered
 * within the school's roster.
 */
export interface RosterMember {
  name: string;
  role: string;
  category: RosterCategory;
}

/** Selectable production types; '' means unspecified (the parser/UI default). */
export const PRODUCTION_TYPES = ['play', 'scenes'] as const;
/** Whether the company performs a full Play or Scenes — drives the program's title line. */
export type ProductionType = (typeof PRODUCTION_TYPES)[number] | '';

/** One competing school (v12 school_N_* + play_N_* fields). */
export interface School {
  name: string;
  /** Always at least one row, as in v12. */
  directors: Director[];
  playTitle: string;
  /** 1-based slot from the blind draw. Defaults to the school's position. */
  performanceOrder: number;
  /**
   * Compliance status per item id (built-in or custom). Absent id ⇒ 'pending',
   * so an untouched tracker is `{}` and costs nothing in the serialized record.
   * Keyed to the school so it survives reordering and renaming (PRD #64).
   */
  compliance: Record<string, ComplianceStatus>;
  /* ── company roster + production metadata (PRD #68) ──
   * All additive and blank-safe: an empty roster + blank metadata is the
   * pre-feature shape and prints nothing. Play title stays canonical in
   * `playTitle` (the Plays section); the parser writes there, not here. */
  /** The company's cast/crew/alternate members, in display order. */
  roster: RosterMember[];
  /** Playwright, for the program's "By {author}" credit. */
  author: string;
  /** Publisher, printed in the program's production credits. */
  publisher: string;
  /** Full play vs. scenes; '' ⇒ unspecified. Drives "Presents scenes from …". */
  productionType: ProductionType;
  /** The setting note printed on the program page. */
  setting: string;
  /** Free-text running time (e.g. "38 minutes"). */
  runtime: string;
  /** Music / other credits note printed on the program page. */
  musicCredits: string;
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
  // Opt-in like the adjudicator PDFs — only wanted once companies are entered (PRD #68).
  { id: 'program', label: 'Audience Program (.docx)', defaultSelected: false },
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

/**
 * Locked-in performance-order draw (PRD #65). Mirrors CritiqueAssignment: the
 * randomizer's output is the ONE thing that persists, stored IN the contest
 * record so it autosaves, syncs, and exports like every other field.
 *
 * The drawn slots ALSO live in the schools' `performanceOrder` fields — the
 * single source of truth every downstream consumer (schedule, letters, critique,
 * documents) already reads, so the draw needs no special wiring downstream. This
 * record is the audit snapshot: `order[i]` is the 1-based slot drawn for the
 * school at form-order index i (the same permutation runDraw wrote into the
 * fields), `drawnAt` is when the draw ran (injected `now`, never the clock), and
 * `locked` freezes the result.
 *
 * `null` on Contest ⇒ no draw has produced the current order — the order is fully
 * hand-editable (pre-#65 contests, and any contest whose draw was voided). While
 * unlocked the CM may re-run the draw freely; only a LOCKED draw is authoritative,
 * and it disables the Plays-section order inputs. Unlocking VOIDS the record
 * (clears it to null) so a hand-edited order is never passed off as a blind draw.
 */
export interface PerformanceDraw {
  /** 1-based drawn slot per school, indexed by form-order position. */
  order: number[];
  /** ISO timestamp the draw ran (injected `now`). */
  drawnAt: string;
  /** Frozen once locked; the Plays-section order inputs disable while true. */
  locked: boolean;
}

/* ────────────────────────── results & advancement ──────────────────────────
 * PRD #66. Post-contest outcome recorded once and flowed into the Awards Script
 * and the advance-clone. Like CritiqueAssignment/PerformanceDraw, the record
 * stores only index references and typed names — school names and plays are
 * re-derived from the contest at read time (a later rename flows through with no
 * results edit). Algorithms (resolving indices into rows) live in a sibling
 * module (model/results.ts, PRD slice C2), the established critique/schedule
 * split; only the data shape and the capped updaters live here.
 */

/** Handbook maxima for the count-capped acting-award lists (2025–26 OAP Handbook). */
export const MAX_BEST_PERFORMERS = 2;
export const MAX_ALL_STAR_CAST = 8;
export const MAX_HONORABLE_MENTION = 8;

/**
 * One individual acting/technical honor: a typed student name plus the school
 * they represent (an index into `contest.schools`). The school name is derived
 * at read time; only the index is stored.
 */
export interface AwardWinner {
  studentName: string;
  /** Index into contest.schools. */
  schoolIndex: number;
}

/** The three acting-award lists that share the append-if-under-cap behavior. */
export type AwardListCategory = 'bestPerformers' | 'allStarCast' | 'honorableMention';

/** Per-category cap for the count-capped acting-award lists. */
export const AWARD_LIST_CAPS: Record<AwardListCategory, number> = {
  bestPerformers: MAX_BEST_PERFORMERS,
  allStarCast: MAX_ALL_STAR_CAST,
  honorableMention: MAX_HONORABLE_MENTION,
};

/**
 * Recorded contest results (PRD #66). `null` on Contest ⇒ nothing recorded yet;
 * the Awards Script uses that to fall back to its blank fill-in template.
 *
 * School references are indices into `contest.schools` (same as advancingEmail's
 * selectedSchoolIndices and the critique position keying). Results are entered
 * post-contest when the field is frozen, so index fragility under reordering is
 * acceptable; the UI picks schools from a dropdown of entered schools.
 */
export interface ContestResults {
  /**
   * Advancing school indices in RANK order (slot 0 = 1st, …). Length is
   * advancingPlaceCount(level) (3, or 2 at Region). Rank is stored but NEVER
   * surfaced — every document announces the advancing companies unordered.
   */
  advancing: number[];
  /** School index of the alternate, or null. Excluded from the advance-clone. */
  alternate: number | null;
  /** Best Performers — up to MAX_BEST_PERFORMERS. */
  bestPerformers: AwardWinner[];
  /** All-Star Cast — up to MAX_ALL_STAR_CAST. */
  allStarCast: AwardWinner[];
  /** Honorable Mention All-Star Cast — up to MAX_HONORABLE_MENTION. */
  honorableMention: AwardWinner[];
  /** Outstanding Technician — at most one per school (keyed by schoolIndex). */
  outstandingTechnicians: AwardWinner[];
  /** School index of the Best Crew, or null. */
  bestCrew: number | null;
}

/**
 * Next-level contest info (PRD #66). An always-present block (blank strings by
 * default, like cmInfo/details) so it can be filled independently of results and
 * needs no null-guarding. Fills the Awards Script's "Next Level of Competition"
 * section and pre-seeds the advance-clone. Does NOT replace
 * `details.bidcContestDate` (the mild overlap is noted for a future cleanup).
 */
export interface NextContestInfo {
  /** ISO date (yyyy-mm-dd) or ''. */
  date: string;
  location: string;
  cmName: string;
  cmEmail: string;
  cmPhone: string;
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
  /**
   * Per-contest custom compliance items (PRD #64), defined once and applied to
   * every school. Built-ins are not stored here — see BUILT_IN_COMPLIANCE_ITEMS.
   */
  customComplianceItems: ComplianceItem[];
  documents: DocumentSelection;
  /** Randomized critique-to-judge assignment; null until first generated. */
  critique: CritiqueAssignment | null;
  /** Blind performance-order draw record (PRD #65); null until first run/voided. */
  draw: PerformanceDraw | null;
  /** Recorded contest results (PRD #66); null until the CM records outcomes. */
  results: ContestResults | null;
  /** Next-level contest info (PRD #66); always present, blank strings by default. */
  nextContest: NextContestInfo;
  /**
   * Readiness check-off status per manual/custom item id (PRD #75). Absent id ⇒
   * 'pending', so an untouched checklist is `{}` and costs nothing serialized.
   * Keyed by id so it survives item reordering/additions. Derived readiness items
   * are NOT stored here — they recompute from contest data in the report (G2).
   */
  readinessChecks: Record<string, ReadinessStatus>;
  /**
   * Per-contest custom readiness items (PRD #75) — CM-added logistics tasks the
   * built-in list doesn't cover. Built-ins are not stored here; see
   * BUILT_IN_READINESS_ITEMS. Carried (reset to Pending) across duplicate/advance
   * as the CM's reusable process template.
   */
  customReadinessItems: ReadinessItemDef[];
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
    bio: '',
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
  return {
    name: '',
    mailingAddress: '',
    needsPower: false,
    needsHotel: false,
    hotelNights: 1,
    dietary: '',
    ttaoContractDate: '',
    paymentPaperworkSentDate: '',
    paymentPaperworkReturnedDate: '',
    bio: '',
  };
}

export function defaultAdjudicators(): Adjudicator[] {
  return Array.from({ length: MAX_JUDGES }, blankAdjudicator);
}

function blankSchool(position: number): School {
  return {
    name: '',
    directors: [{ name: '', email: '' }],
    playTitle: '',
    performanceOrder: position,
    compliance: {},
    roster: [],
    author: '',
    publisher: '',
    productionType: '',
    setting: '',
    runtime: '',
    musicCredits: '',
  };
}

export function defaultSchools(count: number = DEFAULT_SCHOOLS): School[] {
  return Array.from({ length: count }, (_, i) => blankSchool(i + 1));
}

/** The production-metadata scalars on a School (everything the paste fills except the roster). */
export type CompanyMetadata = Pick<
  School,
  'author' | 'publisher' | 'productionType' | 'setting' | 'runtime' | 'musicCredits'
>;

/** The company fields on a School — the roster plus the production metadata (PRD #68). */
type CompanyFields = CompanyMetadata & Pick<School, 'roster'>;

/**
 * A fresh empty company shape — no roster + blank production metadata. Returns a
 * NEW object (and a new roster array) each call, so callers never share a roster
 * reference. Reused by the roll-forward duplicate (which CLEARS the cast, like the
 * play title) and by the v7→v8 migration (which back-fills pre-feature schools).
 */
function blankCompanyFields(): CompanyFields {
  return { roster: [], author: '', publisher: '', productionType: '', setting: '', runtime: '', musicCredits: '' };
}

export function defaultDocumentSelection(): DocumentSelection {
  const selection = {} as DocumentSelection;
  for (const doc of DOCUMENT_TYPES) selection[doc.id] = doc.defaultSelected;
  return selection;
}

export function defaultSpeechwire(): SpeechwireCredentials {
  return { username: '', password: '' };
}

/** A blank next-level info block — all-empty strings (PRD #66). */
export function defaultNextContest(): NextContestInfo {
  return { date: '', location: '', cmName: '', cmEmail: '', cmPhone: '' };
}

/**
 * An empty results record — no advancing/alternate, no awards. The updater
 * helpers lazily materialize this from `results: null` on the first edit; it is
 * never persisted directly (a contest with nothing recorded stays `null`).
 */
export function emptyResults(): ContestResults {
  return {
    advancing: [],
    alternate: null,
    bestPerformers: [],
    allStarCast: [],
    honorableMention: [],
    outstandingTechnicians: [],
    bestCrew: null,
  };
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
    customComplianceItems: [],
    documents: defaultDocumentSelection(),
    critique: null,
    draw: null,
    results: null,
    nextContest: defaultNextContest(),
    readinessChecks: {},
    customReadinessItems: [],
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
    // Custom compliance item DEFINITIONS carry forward (a district requirement
    // recurs year to year); the per-school status they collected does not —
    // each school's tracker resets to empty (all-Pending) below.
    customComplianceItems: contest.customComplianceItems.map((it) => ({ ...it })),
    // Keep each school and its directors; drop this year's play + draw order,
    // last year's collected compliance paperwork, and the company roster +
    // production metadata (the cast is per-production, like the play title —
    // PRD #68). Director names still carry.
    schools: contest.schools.map((s, i) => ({
      ...s,
      directors: s.directors.map((d) => ({ ...d })),
      playTitle: '',
      performanceOrder: i + 1,
      compliance: {},
      ...blankCompanyFields(),
    })),
    // Judges and the draw both change every contest — drop last year's assignment
    // and blind-draw record (performanceOrder is reset to form order above).
    critique: null,
    draw: null,
    // Results and next-level info are single-occurrence data — a roll-forward
    // starts with nothing recorded and a blank next-level block (PRD #66).
    results: null,
    nextContest: defaultNextContest(),
    // Readiness check-offs are per-occurrence — a roll-forward starts fresh (all
    // Pending); the custom item DEFINITIONS carry as the CM's reusable process
    // template (PRD #75 user story 21). Derived items recompute from new data.
    readinessChecks: {},
    customReadinessItems: contest.customReadinessItems.map((it) => ({ ...it })),
    // Device-only credentials are per-contest; never carry them across.
    speechwire: defaultSpeechwire(),
  };
}

/* ────────────────── advancing a contest to the next level ──────────────────
 * PRD #66 (user stories 18–27). The post-contest sibling of duplicateContest:
 * a NEW record pre-filled with only the companies that advanced, the same show
 * (play title + directors) carried up one level. Pure and total, so the policy
 * is tested here, not in the advance-clone dialog (C5).
 */

/**
 * The level each contest advances TO. The chain follows CONTEST_LEVELS; Region
 * has no managed next level (it advances to State, which this app does not
 * manage — PRD user story 26), so it maps to null.
 */
export const NEXT_CONTEST_LEVEL: Record<ContestLevel, ContestLevel | null> = {
  Zone: 'District',
  District: 'BiDistrict',
  BiDistrict: 'Area',
  Area: 'Region',
  Region: null,
};

/** The level up from `level`, or null at Region (advances to unmanaged State). */
export function nextContestLevel(level: ContestLevel): ContestLevel | null {
  return NEXT_CONTEST_LEVEL[level];
}

/** True when this contest can advance (false only at Region). Guards the C5 action. */
export function canAdvanceContest(contest: Contest): boolean {
  return nextContestLevel(contest.identity.contestLevel) !== null;
}

export interface AdvanceContestOptions {
  id?: string;
  /** ISO timestamp for createdAt/updatedAt; defaults to now. */
  now?: string;
  /**
   * Identity overrides applied on top of the advance defaults (bumped level,
   * carried classification + year, cleared district + host fields). The C5
   * dialog uses this to let the CM choose what identity carries forward.
   */
  identity?: Partial<ContestIdentity>;
  /**
   * Pre-seed the next contest's date/location/CM from `contest.nextContest`
   * when those fields are filled (PRD user story 23). Default true.
   */
  seedFromNextContest?: boolean;
}

/**
 * Advances a contest to the next level as a NEW record. Keeps ONLY the companies
 * in `results.advancing` — each with its play title and directors intact (the
 * same show goes up a level) — bumps the level one step, and resets performance
 * order. Returns **null at Region** (no managed next level ⇒ the action is
 * unavailable), so callers guard on the null.
 *
 * Everything tied to this occurrence is cleared: contest date, deadlines,
 * meeting/show times, rehearsal dates, judges, critique/draw, results,
 * next-level info, and device-only credentials. The alternate is excluded (only
 * advancing companies carry). By default the identity carries the classification
 * and year and the CM's own info, clearing the host/district fields; `options`
 * override the carried identity and toggle nextContest pre-seeding. The advancing
 * companies are carried in school FORM order (not rank), so no placement leaks
 * into the new contest's initial order. The source contest is untouched.
 */
export function advanceContest(contest: Contest, options: AdvanceContestOptions = {}): Contest | null {
  const nextLevel = nextContestLevel(contest.identity.contestLevel);
  if (nextLevel === null) return null;

  const now = options.now ?? new Date().toISOString();
  const seed = options.seedFromNextContest ?? true;
  const next = contest.nextContest;

  // Advancing companies only — drop stale indices, then carry in school form
  // order so the reset performance order reveals no rank. The alternate and every
  // non-advancing company are simply not referenced here.
  const advancingSchools = (contest.results?.advancing ?? [])
    .filter((i) => i >= 0 && i < contest.schools.length)
    .slice()
    .sort((a, b) => a - b)
    .map((i) => contest.schools[i]);

  // Identity: bump the level, carry classification + year, clear district + host
  // fields; nextContest.location seeds the venue; the caller's overrides win last.
  const identity: ContestIdentity = {
    contestYear: contest.identity.contestYear,
    contestLevel: nextLevel,
    classification: contest.identity.classification,
    districtNumber: '',
    hostSchoolName: '',
    hostVenueName: seed && next.location ? next.location : '',
    hostAddress: '',
    ...options.identity,
  };

  // CM info carries; when the CM recorded the next-level manager, it overrides the
  // carried name/email/phone (a different person usually runs the next level).
  const cmInfo: CmInfo = { ...contest.cmInfo };
  if (seed) {
    if (next.cmName) cmInfo.name = next.cmName;
    if (next.cmEmail) cmInfo.email = next.cmEmail;
    if (next.cmPhone) cmInfo.phone = next.cmPhone;
  }

  const details: ContestDetails = { ...contest.details, ...CLEARED_DETAIL_FIELDS };
  if (seed && next.date) details.contestDate = next.date;

  return {
    ...contest,
    id: options.id ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    identity,
    cmInfo,
    details,
    // Judges change every contest — start fresh.
    adjudicators: defaultAdjudicators(),
    // Custom compliance item DEFINITIONS carry; per-school status resets below.
    customComplianceItems: contest.customComplianceItems.map((it) => ({ ...it })),
    // Only advancing companies, the same show (playTitle + directors) intact.
    // The company roster + production metadata CARRY with the show (PRD #68 —
    // the same company goes up a level); roster is deep-copied so editing the
    // advanced contest never touches the source. Performance order resets to
    // form position; last year's paperwork drops.
    schools: advancingSchools.map((s, i) => ({
      ...s,
      directors: s.directors.map((d) => ({ ...d })),
      roster: s.roster.map((m) => ({ ...m })),
      performanceOrder: i + 1,
      compliance: {},
    })),
    critique: null,
    draw: null,
    // Season-specific — the next contest records its own outcome and next level.
    results: null,
    nextContest: defaultNextContest(),
    // The advanced contest is its own fresh event — check-offs reset (all
    // Pending) while the custom item DEFINITIONS carry as the CM's reusable
    // process template (PRD #75 user story 22). Derived items recompute.
    readinessChecks: {},
    customReadinessItems: contest.customReadinessItems.map((it) => ({ ...it })),
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

/* ────────────────────── adjudicator contracting milestones ──────────────────────
 * PRD #67. Three per-judge date fields tracked as a check-off list. The DATE is
 * the record — '' ⇒ not done, a date ⇒ done. This ordered list is the single
 * source of truth for the milestones' keys / labels / order, consumed by BOTH the
 * Adjudicator Info Sheet (D2) and the Judges UI (D3) via adjudicatorMilestoneStatus,
 * so nothing drifts. Milestone fields are Adjudicator string keys.
 */
export const ADJUDICATOR_MILESTONES = [
  { key: 'ttaoContractDate', label: 'TTAO contract' },
  { key: 'paymentPaperworkSentDate', label: 'Payment paperwork sent' },
  { key: 'paymentPaperworkReturnedDate', label: 'Payment paperwork returned' },
] as const satisfies readonly { key: keyof Adjudicator; label: string }[];

/** The Adjudicator date fields that back a milestone. */
export type AdjudicatorMilestoneKey = (typeof ADJUDICATOR_MILESTONES)[number]['key'];

/** One milestone's derived state for a judge. `done` is date presence, nothing more. */
export interface AdjudicatorMilestoneStatus {
  key: AdjudicatorMilestoneKey;
  label: string;
  date: string;
  done: boolean;
}

/**
 * Shared pure derivation: an adjudicator → the ordered milestone rows. The one
 * place the done-rule (a non-blank date) and the labels/order live, so the Info
 * Sheet and the Judges UI can never disagree.
 */
export function adjudicatorMilestoneStatus(judge: Adjudicator): AdjudicatorMilestoneStatus[] {
  return ADJUDICATOR_MILESTONES.map(({ key, label }) => {
    const date = judge[key];
    return { key, label, date, done: date.trim() !== '' };
  });
}

/**
 * Checks or unchecks one contracting milestone for a judge. Checking stamps the
 * injected `now`'s date ('YYYY-MM-DD'); unchecking clears it back to ''. The stamp
 * comes from `now` (same value that bumps updatedAt) — the model never reads the
 * clock on its own for a document-visible value. Editing an already-stamped date
 * goes through the regular withAdjudicator patch, not this updater.
 */
export function setAdjudicatorMilestone(
  contest: Contest,
  index: number,
  key: AdjudicatorMilestoneKey,
  done: boolean,
  now?: string,
): Contest {
  const stamp = now ?? new Date().toISOString();
  const date = done ? stamp.slice(0, 10) : '';
  const adjudicators = contest.adjudicators.map((j, i) => (i === index ? { ...j, [key]: date } : j));
  return { ...touch(contest, stamp), adjudicators };
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

/* ────────────────────────── company roster ──────────────────────────
 * PRD #68. Per-school roster edits + the paste-import applier + the informational
 * 20+4 counter. Every updater is immutable and bumps updatedAt; an out-of-range
 * school (or member) index is a no-op returning the contest untouched, matching
 * the director/compliance helpers. The metadata scalars (author/publisher/type/
 * setting/runtime/musicCredits) go through the existing withSchool patch.
 */

/** Appends a roster member to a school. Out-of-range school ⇒ no-op. */
export function addRosterMember(
  contest: Contest,
  schoolIndex: number,
  member: RosterMember,
  now?: string,
): Contest {
  if (schoolIndex < 0 || schoolIndex >= contest.schools.length) return contest;
  const schools = contest.schools.map((s, i) =>
    i === schoolIndex ? { ...s, roster: [...s.roster, { ...member }] } : s,
  );
  return { ...touch(contest, now), schools };
}

/** Patches one roster member (name / role / category). Out-of-range indices ⇒ no-op. */
export function updateRosterMember(
  contest: Contest,
  schoolIndex: number,
  memberIndex: number,
  patch: Partial<RosterMember>,
  now?: string,
): Contest {
  const school = contest.schools[schoolIndex];
  if (!school || memberIndex < 0 || memberIndex >= school.roster.length) return contest;
  const schools = contest.schools.map((s, i) =>
    i === schoolIndex
      ? { ...s, roster: s.roster.map((m, mi) => (mi === memberIndex ? { ...m, ...patch } : m)) }
      : s,
  );
  return { ...touch(contest, now), schools };
}

/** Removes the roster member at `memberIndex`. Out-of-range indices ⇒ no-op. */
export function removeRosterMember(
  contest: Contest,
  schoolIndex: number,
  memberIndex: number,
  now?: string,
): Contest {
  const school = contest.schools[schoolIndex];
  if (!school || memberIndex < 0 || memberIndex >= school.roster.length) return contest;
  const schools = contest.schools.map((s, i) =>
    i === schoolIndex ? { ...s, roster: s.roster.filter((_, mi) => mi !== memberIndex) } : s,
  );
  return { ...touch(contest, now), schools };
}

/**
 * Adjacent swap of two roster members (mirrors moveCritiqueAssignment): swaps the
 * member at `memberIndex` with the one at `memberIndex + direction`. `direction` is
 * ±1; any other value, an out-of-range target, or an out-of-range school is a no-op.
 */
export function moveRosterMember(
  contest: Contest,
  schoolIndex: number,
  memberIndex: number,
  direction: number,
  now?: string,
): Contest {
  if (direction !== 1 && direction !== -1) return contest;
  const school = contest.schools[schoolIndex];
  if (!school) return contest;
  const target = memberIndex + direction;
  if (memberIndex < 0 || memberIndex >= school.roster.length || target < 0 || target >= school.roster.length) {
    return contest;
  }
  const roster = [...school.roster];
  [roster[memberIndex], roster[target]] = [roster[target], roster[memberIndex]];
  const schools = contest.schools.map((s, i) => (i === schoolIndex ? { ...s, roster } : s));
  return { ...touch(contest, now), schools };
}

/**
 * The structured result of E2's `parseCompanyBlock` — the director-submitted block
 * turned into data. Applied to a school by `importCompany`. Play title lives in the
 * Plays section, so it rides here alongside the metadata and importCompany routes it
 * to `School.playTitle`. `directorNames` are NAMES only (emails aren't in the block);
 * importCompany maps them onto `School.directors` preserving existing emails by
 * position. The model owns this contract so the parser and the applier can't drift.
 */
export interface ParsedCompany {
  playTitle: string;
  metadata: CompanyMetadata;
  directorNames: string[];
  roster: RosterMember[];
}

/**
 * Applies a parsed company block to a school in one immutable update: writes the
 * production metadata + play title + roster, and maps the parsed director NAMES onto
 * `School.directors` preserving any existing emails by position (appending blank-email
 * rows as needed). When the parse yielded no director names, existing directors are
 * left untouched (so a partial paste never wipes the director rows). Out-of-range
 * school index ⇒ no-op.
 */
export function importCompany(
  contest: Contest,
  schoolIndex: number,
  parsed: ParsedCompany,
  now?: string,
): Contest {
  if (schoolIndex < 0 || schoolIndex >= contest.schools.length) return contest;
  const schools = contest.schools.map((s, i) => {
    if (i !== schoolIndex) return s;
    const directors =
      parsed.directorNames.length === 0
        ? s.directors
        : parsed.directorNames.map((name, di) => ({ name, email: s.directors[di]?.email ?? '' }));
    return {
      ...s,
      playTitle: parsed.playTitle,
      author: parsed.metadata.author,
      publisher: parsed.metadata.publisher,
      productionType: parsed.metadata.productionType,
      setting: parsed.metadata.setting,
      runtime: parsed.metadata.runtime,
      musicCredits: parsed.metadata.musicCredits,
      roster: parsed.roster.map((m) => ({ ...m })),
      directors,
    };
  });
  return { ...touch(contest, now), schools };
}

/** The informational 20+4 company counts (PRD #68). */
export interface CompanyCounts {
  /** Cast + crew members — toward the 20 limit. */
  castCrew: number;
  /** Alternates — toward the 4 limit. */
  alternates: number;
  /** Every roster member — toward the 24 total. */
  total: number;
}

/**
 * Counts a school's roster: cast + crew toward 20, alternates toward 4, all toward
 * 24. **Counts only — no cap, no clamping, no warning** (PRD #68 user story 12);
 * an over-count is reported faithfully so the UI can surface it without blocking.
 */
export function companyCounts(school: School): CompanyCounts {
  let castCrew = 0;
  let alternates = 0;
  for (const m of school.roster) {
    if (m.category === 'alternate') alternates++;
    else castCrew++;
  }
  return { castCrew, alternates, total: castCrew + alternates };
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

/* ─────────────────────── performance-order draw ───────────────────────
 * PRD #65. The blind-draw lifecycle, mirroring the critique randomizer: the pure
 * model/draw.ts generator produces the permutation; these helpers WRITE it into
 * the schools' performanceOrder fields (the single source of truth downstream)
 * and record the audit snapshot, then freeze or void it. Every edit is immutable
 * and bumps updatedAt so it autosaves.
 */

/**
 * Runs a draw: writes the permutation into the schools' performanceOrder fields
 * (school i ⇒ slot `order[i]`) and records the audit snapshot, UNLOCKED. Re-running
 * while unlocked replaces both the order and the timestamp — a misfire is costless.
 * A LOCKED draw is frozen: running against it is a no-op (unlock first). `order` is
 * normally drawOrder(numSchools(contest)); schools beyond its length keep their slot.
 */
export function runDraw(contest: Contest, order: number[], now?: string): Contest {
  if (contest.draw?.locked) return contest;
  const stamp = now ?? new Date().toISOString();
  const schools = contest.schools.map((s, i) => (i < order.length ? { ...s, performanceOrder: order[i] } : s));
  return { ...touch(contest, stamp), schools, draw: { order: [...order], drawnAt: stamp, locked: false } };
}

/**
 * Freezes the current draw, disabling the Plays-section order inputs. No-op when
 * there is no draw record.
 */
export function lockDraw(contest: Contest, now?: string): Contest {
  if (!contest.draw) return contest;
  return { ...touch(contest, now), draw: { ...contest.draw, locked: true } };
}

/**
 * VOIDS the draw record (clears it to null) and re-enables manual order edits.
 * The drawn slots stay in the schools' fields — they simply become editable
 * again; the audit record is gone, so a subsequent hand-edit is never presented
 * as the product of a blind draw. No-op when there is no draw record.
 */
export function unlockDraw(contest: Contest, now?: string): Contest {
  if (!contest.draw) return contest;
  return { ...touch(contest, now), draw: null };
}

/* ────────────────────────── results & advancement ──────────────────────────
 * PRD #66. Post-contest updaters. Every helper is immutable and bumps updatedAt;
 * a no-op (an add past a cap, a remove of an absent entry) returns the contest
 * unchanged so it neither mutates nor arms autosave. The nullable `results`
 * record is lazily materialized from emptyResults() on the first meaningful edit.
 */

/**
 * How many companies advance from this level — the handbook's 3-vs-2 rule
 * centralized: 2 at Region (which advances to State, a 2-company field), 3
 * everywhere else. Drives the default advancing-slot count.
 */
export function advancingPlaceCount(level: ContestLevel): number {
  return level === 'Region' ? 2 : 3;
}

/**
 * Applies a mutation to the (lazily materialized) results record. The mutator
 * returns the next record, or `null` to signal a no-op (cap hit, out-of-range
 * index) — in which case the contest is returned untouched (no updatedAt bump,
 * no results record conjured from null).
 */
function updateResults(
  contest: Contest,
  mutate: (results: ContestResults) => ContestResults | null,
  now?: string,
): Contest {
  const next = mutate(contest.results ?? emptyResults());
  if (next === null) return contest;
  return { ...touch(contest, now), results: next };
}

/**
 * Sets the advancing schools, in RANK order (slot 0 = 1st). Truncated to
 * advancingPlaceCount(level) — indices past the cap are dropped. Rank is stored
 * but never surfaced downstream.
 */
export function setAdvancing(contest: Contest, schoolIndices: number[], now?: string): Contest {
  const cap = advancingPlaceCount(contest.identity.contestLevel);
  return updateResults(contest, (r) => ({ ...r, advancing: schoolIndices.slice(0, cap) }), now);
}

/** Sets (or clears, with null) the alternate school index. */
export function setAlternate(contest: Contest, schoolIndex: number | null, now?: string): Contest {
  return updateResults(contest, (r) => ({ ...r, alternate: schoolIndex }), now);
}

/** Sets (or clears, with null) the Best Crew school index. */
export function setBestCrew(contest: Contest, schoolIndex: number | null, now?: string): Contest {
  return updateResults(contest, (r) => ({ ...r, bestCrew: schoolIndex }), now);
}

/**
 * Appends an acting-award winner to one of the count-capped lists (Best
 * Performers / All-Star / Honorable Mention). An add past the category's cap
 * (AWARD_LIST_CAPS) is a no-op.
 */
export function addAwardWinner(
  contest: Contest,
  category: AwardListCategory,
  winner: AwardWinner,
  now?: string,
): Contest {
  return updateResults(contest, (r) => {
    if (r[category].length >= AWARD_LIST_CAPS[category]) return null;
    return { ...r, [category]: [...r[category], { ...winner }] };
  }, now);
}

/** Removes the acting-award winner at `index` from a capped list. Out-of-range ⇒ no-op. */
export function removeAwardWinner(
  contest: Contest,
  category: AwardListCategory,
  index: number,
  now?: string,
): Contest {
  return updateResults(contest, (r) => {
    if (index < 0 || index >= r[category].length) return null;
    return { ...r, [category]: r[category].filter((_, i) => i !== index) };
  }, now);
}

/**
 * Records the Outstanding Technician for a school (student name typed, school
 * from a dropdown). At most ONE per school: if the school already has a
 * technician recorded, this updates that entry's name rather than adding a
 * second — the one-per-school cap enforced by construction.
 */
export function setOutstandingTechnician(
  contest: Contest,
  schoolIndex: number,
  studentName: string,
  now?: string,
): Contest {
  return updateResults(contest, (r) => {
    const winner: AwardWinner = { studentName, schoolIndex };
    const at = r.outstandingTechnicians.findIndex((w) => w.schoolIndex === schoolIndex);
    const outstandingTechnicians =
      at >= 0
        ? r.outstandingTechnicians.map((w, i) => (i === at ? winner : w))
        : [...r.outstandingTechnicians, winner];
    return { ...r, outstandingTechnicians };
  }, now);
}

/** Removes a school's Outstanding Technician. No entry for that school ⇒ no-op. */
export function removeOutstandingTechnician(contest: Contest, schoolIndex: number, now?: string): Contest {
  return updateResults(contest, (r) => {
    if (!r.outstandingTechnicians.some((w) => w.schoolIndex === schoolIndex)) return null;
    return {
      ...r,
      outstandingTechnicians: r.outstandingTechnicians.filter((w) => w.schoolIndex !== schoolIndex),
    };
  }, now);
}

/** Clears all recorded results back to null (the Awards Script reverts to blanks). No-op if already null. */
export function clearResults(contest: Contest, now?: string): Contest {
  if (contest.results === null) return contest;
  return { ...touch(contest, now), results: null };
}

/** Patches the next-level contest info block. */
export function withNextContest(contest: Contest, patch: Partial<NextContestInfo>, now?: string): Contest {
  return { ...touch(contest, now), nextContest: { ...contest.nextContest, ...patch } };
}

/* ────────────────────────── compliance tracker ──────────────────────────
 * PRD #64. Per-school paperwork checklist. Status lives on each School (keyed
 * to the item id, absent ⇒ pending); custom item definitions live on the
 * contest and apply to every school. Fully additive — nothing outside the
 * Compliance UI section reads any of this, and an untouched tracker adds
 * nothing to the serialized record.
 */

/** All compliance items in display order: the fixed built-ins, then customs. */
export function complianceItems(contest: Contest): ComplianceItem[] {
  return [...BUILT_IN_COMPLIANCE_ITEMS, ...contest.customComplianceItems];
}

/**
 * Sets one school's status for one item. Writing 'pending' DROPS the key (the
 * default), so a school's map only ever holds meaningful 'received'/'na' entries
 * and an untouched tracker stays `{}`. Out-of-range school index is a no-op.
 * Works for built-in and custom item ids alike.
 */
export function setComplianceStatus(
  contest: Contest,
  schoolIndex: number,
  itemId: string,
  status: ComplianceStatus,
  now?: string,
): Contest {
  if (schoolIndex < 0 || schoolIndex >= contest.schools.length) return contest;
  const schools = contest.schools.map((s, i) => {
    if (i !== schoolIndex) return s;
    const compliance = { ...s.compliance };
    if (status === 'pending') delete compliance[itemId];
    else compliance[itemId] = status;
    return { ...s, compliance };
  });
  return { ...touch(contest, now), schools };
}

/**
 * Adds a custom compliance item. The caller supplies the id (the model stays
 * pure — no id generation, no clock/RNG); the UI mints a uuid. The item applies
 * to every school automatically just by entering the shared list — no per-school
 * write, since an absent status already reads as Pending.
 */
export function addComplianceItem(contest: Contest, item: ComplianceItem, now?: string): Contest {
  return { ...touch(contest, now), customComplianceItems: [...contest.customComplianceItems, item] };
}

/**
 * Removes a custom compliance item and DROPS its status from every school, so no
 * orphaned entries linger. Built-in ids are never in customComplianceItems, so a
 * built-in can't be removed; an id that isn't a current custom item is a no-op.
 */
export function removeComplianceItem(contest: Contest, itemId: string, now?: string): Contest {
  if (!contest.customComplianceItems.some((it) => it.id === itemId)) return contest;
  const customComplianceItems = contest.customComplianceItems.filter((it) => it.id !== itemId);
  const schools = contest.schools.map((s) => {
    if (!(itemId in s.compliance)) return s;
    const compliance = { ...s.compliance };
    delete compliance[itemId];
    return { ...s, compliance };
  });
  return { ...touch(contest, now), customComplianceItems, schools };
}

export const COMPLIANCE_COLORS = ['red', 'yellow', 'green'] as const;
export type ComplianceColor = (typeof COMPLIANCE_COLORS)[number];

export interface ComplianceProgress {
  /** Items marked Received. */
  done: number;
  /** Items not marked N/A — the counter's denominator. */
  applicable: number;
  color: ComplianceColor;
}

/**
 * Per-school progress over the given item list (pass complianceItems(contest)).
 * An item is applicable unless the school marked it N/A; `done` counts Received.
 * Green when nothing applicable is still pending — every applicable item is
 * Received (all-N/A ⇒ green 0/0, nothing to collect); red at zero Received;
 * yellow in between. Absent status ⇒ Pending. Pure derivation, no mutation.
 */
export function complianceProgress(school: School, items: readonly ComplianceItem[]): ComplianceProgress {
  let applicable = 0;
  let done = 0;
  for (const item of items) {
    const status = school.compliance[item.id] ?? 'pending';
    if (status === 'na') continue;
    applicable++;
    if (status === 'received') done++;
  }
  const pending = applicable - done;
  const color: ComplianceColor = pending === 0 ? 'green' : done === 0 ? 'red' : 'yellow';
  return { done, applicable, color };
}

/* ────────────────────────── readiness checklist ──────────────────────────
 * PRD #75. The manual/custom check-off state. Status lives on the contest keyed
 * to the item id (absent ⇒ pending); custom item definitions live on the contest
 * too. Fully additive — only the readiness page (G3) reads any of this via the
 * report (G2), and an untouched checklist adds nothing to the serialized record.
 */

/**
 * The stored check-off status for a manual/custom item id — 'pending' when
 * absent (the default), matching the compliance tracker's absent-means-Pending
 * convention. Built-in and custom ids alike. The readiness report (G2) reads
 * every manual/custom item's status through this.
 */
export function resolveReadinessStatus(contest: Contest, itemId: string): ReadinessStatus {
  return contest.readinessChecks[itemId] ?? 'pending';
}

/**
 * Sets one manual/custom item's check-off status. Writing 'pending' DROPS the key
 * (the default), so the map only ever holds meaningful 'done'/'na' entries and an
 * untouched checklist stays `{}`. Works for built-in and custom item ids alike;
 * status is keyed by id, so it survives item reordering/additions (PRD user
 * story 24).
 */
export function setReadinessStatus(
  contest: Contest,
  itemId: string,
  status: ReadinessStatus,
  now?: string,
): Contest {
  const readinessChecks = { ...contest.readinessChecks };
  if (status === 'pending') delete readinessChecks[itemId];
  else readinessChecks[itemId] = status;
  return { ...touch(contest, now), readinessChecks };
}

/**
 * Adds a custom readiness item. The caller supplies the id (the model stays pure —
 * no id generation, no clock/RNG); the UI mints a uuid. The item is Pending until
 * checked, since an absent status already reads as Pending.
 */
export function addReadinessItem(contest: Contest, item: ReadinessItemDef, now?: string): Contest {
  return { ...touch(contest, now), customReadinessItems: [...contest.customReadinessItems, item] };
}

/**
 * Removes a custom readiness item and DROPS its check-off status, so no orphaned
 * entry lingers. Built-in ids are never in customReadinessItems, so a built-in
 * can't be removed; an id that isn't a current custom item is a no-op.
 */
export function removeReadinessItem(contest: Contest, itemId: string, now?: string): Contest {
  if (!contest.customReadinessItems.some((it) => it.id === itemId)) return contest;
  const customReadinessItems = contest.customReadinessItems.filter((it) => it.id !== itemId);
  if (!(itemId in contest.readinessChecks)) {
    return { ...touch(contest, now), customReadinessItems };
  }
  const readinessChecks = { ...contest.readinessChecks };
  delete readinessChecks[itemId];
  return { ...touch(contest, now), customReadinessItems, readinessChecks };
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
  // v3 (Slices 10–18) predate the compliance tracker (PRD #64): give every
  // school an empty (all-Pending) status map and the contest no custom items.
  3: (raw) => ({
    ...raw,
    customComplianceItems: [],
    schools: Array.isArray(raw.schools)
      ? (raw.schools as Record<string, unknown>[]).map((s) => ({ ...s, compliance: {} }))
      : raw.schools,
  }),
  // v4 (Group A / compliance tracker) predates the performance-order draw (PRD
  // #65): no draw record, so the order inputs stay fully hand-editable.
  4: (raw) => ({ ...raw, draw: null }),
  // v5 (Group B / performance-order draw) predates results & advancement (PRD
  // #66): nothing recorded (results: null) and a blank next-level info block.
  5: (raw) => ({ ...raw, results: null, nextContest: defaultNextContest() }),
  // v6 (Group C / results & advancement) predates the contracting checklist (PRD
  // #67): every adjudicator gains three blank milestone dates (all not-done).
  6: (raw) => ({
    ...raw,
    adjudicators: Array.isArray(raw.adjudicators)
      ? (raw.adjudicators as Record<string, unknown>[]).map((j) => ({
          ...j,
          ttaoContractDate: '',
          paymentPaperworkSentDate: '',
          paymentPaperworkReturnedDate: '',
        }))
      : raw.adjudicators,
  }),
  // v7 (Group D / contracting checklist) predates the company roster (PRD #68):
  // every school gains an empty roster + blank production metadata, and every
  // adjudicator plus CmInfo gains a blank bio. All additive and blank-safe.
  7: (raw) => ({
    ...raw,
    cmInfo:
      typeof raw.cmInfo === 'object' && raw.cmInfo !== null
        ? { ...(raw.cmInfo as Record<string, unknown>), bio: '' }
        : raw.cmInfo,
    adjudicators: Array.isArray(raw.adjudicators)
      ? (raw.adjudicators as Record<string, unknown>[]).map((j) => ({ ...j, bio: '' }))
      : raw.adjudicators,
    schools: Array.isArray(raw.schools)
      ? (raw.schools as Record<string, unknown>[]).map((s) => ({ ...s, ...blankCompanyFields() }))
      : raw.schools,
  }),
  // v8 (Group E / company roster) predates the readiness page (PRD #75): add an
  // empty (all-Pending) check-off map and no custom readiness items. Additive and
  // blank-safe — an old contest loads as an all-Pending checklist. LAST bump in
  // the A–E→G sequence.
  8: (raw) => ({ ...raw, readinessChecks: {}, customReadinessItems: [] }),
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
