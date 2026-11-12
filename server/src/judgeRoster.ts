/**
 * The judge roster the app publishes for the public questionnaire (PRD #252), and
 * the one lookup the public page may make against it.
 *
 * The app builds the roster (app/src/questionnaire/roster.ts); the server only
 * validates its shape on write and answers "which contests is this email on?".
 * Validation is strict and size-capped because this is the one contest-derived
 * blob the server reads: unknown fields are dropped, over-long strings and
 * dangling contest ids are refused.
 */

export interface RosterContest {
  id: string;
  title: string;
  level: string;
  date: string;
  host: string;
  cmEmail: string;
}

export interface RosterJudge {
  email: string;
  name: string;
  contestIds: string[];
}

export interface JudgeRoster {
  contests: RosterContest[];
  judges: RosterJudge[];
}

export const MAX_ROSTER_CONTESTS = 500;
export const MAX_ROSTER_JUDGES = 5000;
const MAX_FIELD_LENGTH = 320;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_FIELD_LENGTH ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Returns a clean roster, or null when the input is not a valid roster. */
export function parseRoster(input: unknown): JudgeRoster | null {
  const raw = record(input);
  if (!raw || !Array.isArray(raw.contests) || !Array.isArray(raw.judges)) return null;
  if (raw.contests.length > MAX_ROSTER_CONTESTS || raw.judges.length > MAX_ROSTER_JUDGES) return null;

  const contests: RosterContest[] = [];
  const ids = new Set<string>();
  for (const item of raw.contests) {
    const c = record(item);
    if (!c) return null;
    const fields = ['id', 'title', 'level', 'date', 'host', 'cmEmail'].map((k) => str(c[k]));
    if (fields.some((f) => f === null)) return null;
    const [id, title, level, date, host, cmEmail] = fields as string[];
    if (id === '' || ids.has(id)) return null;
    ids.add(id);
    contests.push({ id, title, level, date, host, cmEmail });
  }

  const judges: RosterJudge[] = [];
  const emails = new Set<string>();
  for (const item of raw.judges) {
    const j = record(item);
    if (!j) return null;
    const email = str(j.email);
    const name = str(j.name);
    if (email === null || name === null || !Array.isArray(j.contestIds)) return null;
    const normalized = normalizeEmail(email);
    if (normalized === '' || emails.has(normalized)) return null;
    const contestIds = j.contestIds.map(str);
    if (contestIds.some((id) => id === null || !ids.has(id))) return null;
    emails.add(normalized);
    judges.push({ email: normalized, name, contestIds: contestIds as string[] });
  }

  return { contests, judges };
}

export interface JudgeLookup {
  judgeName: string;
  contests: RosterContest[];
}

/** The judge's contests, in roster order, or null when the email is not on it. */
export function findJudge(roster: JudgeRoster, email: string): JudgeLookup | null {
  const key = normalizeEmail(email);
  if (key === '') return null;
  const judge = roster.judges.find((j) => j.email === key);
  if (!judge) return null;
  const contests = roster.contests.filter((c) => judge.contestIds.includes(c.id));
  if (contests.length === 0) return null;
  return { judgeName: judge.name, contests };
}

/* ── submissions ── */

export interface ContestAnswers {
  hotelBefore: boolean;
  hotelAfter: boolean;
  requestingFlight: boolean;
  /** Power at the judging table; asked per contest (it was once one answer for all). */
  needsPower: boolean;
}

export interface SubmissionAnswers {
  cellPhone: string;
  mailingAddress: string;
  dietary: string;
  bio: string;
  notes: string;
  contests: Record<string, ContestAnswers>;
}

/** Per-field length caps for the free-text answers. */
export const ANSWER_LIMITS = {
  cellPhone: 40,
  mailingAddress: 400,
  dietary: 1000,
  bio: 4000,
  notes: 4000,
} as const;

/**
 * Returns clean answers, or null when the input is malformed, a text answer is
 * too long, or it answers for a contest the judge is not on. Unknown fields are
 * dropped. Answering for only some of the judge's contests is allowed.
 */
export function parseAnswers(input: unknown, judgeContestIds: readonly string[]): SubmissionAnswers | null {
  const raw = record(input);
  if (!raw) return null;
  const text: Partial<Record<keyof typeof ANSWER_LIMITS, string>> = {};
  for (const [key, max] of Object.entries(ANSWER_LIMITS) as [keyof typeof ANSWER_LIMITS, number][]) {
    const value = raw[key];
    if (typeof value !== 'string' || value.length > max) return null;
    text[key] = value;
  }
  // Legacy shape: one top-level power answer for every contest. Still accepted
  // (a cached page may send it) and used where a contest gives no answer of its own.
  if (raw.needsPower !== undefined && typeof raw.needsPower !== 'boolean') return null;
  const legacyPower = raw.needsPower === true;
  const contestsRaw = record(raw.contests);
  if (!contestsRaw) return null;
  const contests: Record<string, ContestAnswers> = {};
  for (const [id, value] of Object.entries(contestsRaw)) {
    if (!judgeContestIds.includes(id)) return null;
    const c = record(value);
    if (
      !c ||
      typeof c.hotelBefore !== 'boolean' ||
      typeof c.hotelAfter !== 'boolean' ||
      typeof c.requestingFlight !== 'boolean' ||
      (c.needsPower !== undefined && typeof c.needsPower !== 'boolean')
    ) {
      return null;
    }
    contests[id] = {
      hotelBefore: c.hotelBefore,
      hotelAfter: c.hotelAfter,
      requestingFlight: c.requestingFlight,
      needsPower: typeof c.needsPower === 'boolean' ? c.needsPower : legacyPower,
    };
  }
  return {
    cellPhone: text.cellPhone!,
    mailingAddress: text.mailingAddress!,
    dietary: text.dietary!,
    bio: text.bio!,
    notes: text.notes!,
    contests,
  };
}
