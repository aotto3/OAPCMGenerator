/**
 * Judge questionnaire submissions (PRD #252): the answer shape the public page
 * sends, how it lands in a contest, and how a Zone pair is asked about as one.
 *
 * Pure throughout. `applySubmission` is the one place answers enter a contest:
 * it writes the judge-owned fields into every active judge row whose email
 * matches, only when the submission is newer than that row's questionnaire stamp,
 * and never touches name, email, or the contracting dates. Re-applying the same
 * submission is a no-op (the stamp already equals it), so devices converge.
 */
import type { Contest } from '../model/contest';
import { activeJudgeSlots, normalizeEmail, setJudge } from '../model/judgePanel';
import type { RosterContest } from './roster';

export interface ContestAnswers {
  hotelBefore: boolean;
  hotelAfter: boolean;
  requestingFlight: boolean;
  /** Power at the judging table, asked per contest. Absent on older submissions. */
  needsPower?: boolean;
}

export interface SubmissionAnswers {
  cellPhone: string;
  mailingAddress: string;
  dietary: string;
  /** Legacy: the one power answer for every contest, before it moved per contest. */
  needsPower?: boolean;
  bio: string;
  /** "What else would you like me to know": saved as the CM-only judge notes. */
  notes: string;
  /** Keyed by contest id; only the judge's own contests. */
  contests: Record<string, ContestAnswers>;
}

export interface JudgeSubmission {
  email: string;
  /** ISO timestamp set by the server. */
  submittedAt: string;
  answers: SubmissionAnswers;
}

export function blankAnswers(contestIds: string[]): SubmissionAnswers {
  return {
    cellPhone: '',
    mailingAddress: '',
    dietary: '',
    bio: '',
    notes: '',
    contests: Object.fromEntries(
      contestIds.map((id) => [id, { hotelBefore: false, hotelAfter: false, requestingFlight: false, needsPower: false }]),
    ),
  };
}

/** A contest's power answer, falling back to an older submission's single answer. */
export function contestPower(perContest: ContestAnswers, answers: SubmissionAnswers): boolean {
  return perContest.needsPower ?? answers.needsPower ?? false;
}

export function applySubmission(contest: Contest, submission: JudgeSubmission, now: string): Contest {
  const perContest = submission.answers.contests[contest.id];
  if (!perContest) return contest;
  const email = normalizeEmail(submission.email);
  let next = contest;
  activeJudgeSlots(contest).forEach(({ index: i, judge }) => {
    if (normalizeEmail(judge.email) !== email) return;
    if (submission.submittedAt <= judge.questionnaireUpdatedAt) return;
    const a = submission.answers;
    next = setJudge(
      next,
      i,
      {
        cellPhone: a.cellPhone,
        mailingAddress: a.mailingAddress,
        dietary: a.dietary,
        needsPower: contestPower(perContest, a),
        bio: a.bio,
        judgeNotes: a.notes,
        needsHotel: perContest.hotelBefore || perContest.hotelAfter,
        hotelNights: { before: perContest.hotelBefore, after: perContest.hotelAfter },
        requestingFlight: perContest.requestingFlight,
        questionnaireUpdatedAt: submission.submittedAt,
      },
      now,
    );
  });
  return next;
}

/** Applies every submission, oldest first; returns the same object when nothing changed. */
export function applySubmissions(contest: Contest, submissions: JudgeSubmission[], now: string): Contest {
  return [...submissions]
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0))
    .reduce((c, s) => applySubmission(c, s, now), contest);
}

/* ── Zone pairs ──
 * Zone 1 and Zone 2 are separate one-day contests. A judge on both, on back-to-back
 * days, is asked about the pair at once (before / between / after, one fly
 * question), matching how CMs book: "between" is the first zone's night after and
 * the second zone's night before. */

export type ContestGroup =
  | { kind: 'single'; contest: RosterContest }
  | { kind: 'zonePair'; first: RosterContest; second: RosterContest };

export interface GroupAnswers {
  before: boolean;
  /** Zone pairs only. */
  between: boolean;
  after: boolean;
  requestingFlight: boolean;
  needsPower: boolean;
}

/** The ISO date `days` calendar days from `iso` (negative goes back). Clock-free. */
export function shiftDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextDay(iso: string): string {
  return shiftDays(iso, 1);
}

/** Groups contests (already in date order) into singles and back-to-back Zone pairs. */
export function groupContests(contests: RosterContest[]): ContestGroup[] {
  const groups: ContestGroup[] = [];
  for (let i = 0; i < contests.length; i++) {
    const a = contests[i];
    const b = contests[i + 1];
    if (b && a.level === 'Zone' && b.level === 'Zone' && a.date !== '' && b.date === nextDay(a.date)) {
      groups.push({ kind: 'zonePair', first: a, second: b });
      i++;
    } else {
      groups.push({ kind: 'single', contest: a });
    }
  }
  return groups;
}

export function groupContestIds(group: ContestGroup): string[] {
  return group.kind === 'single' ? [group.contest.id] : [group.first.id, group.second.id];
}

const NONE: ContestAnswers = { hotelBefore: false, hotelAfter: false, requestingFlight: false, needsPower: false };

/** Reads a group's answers out of the per-contest answers. */
export function readGroup(group: ContestGroup, contests: Record<string, ContestAnswers>): GroupAnswers {
  if (group.kind === 'single') {
    const c = contests[group.contest.id] ?? NONE;
    return {
      before: c.hotelBefore,
      between: false,
      after: c.hotelAfter,
      requestingFlight: c.requestingFlight,
      needsPower: c.needsPower ?? false,
    };
  }
  const first = contests[group.first.id] ?? NONE;
  const second = contests[group.second.id] ?? NONE;
  return {
    before: first.hotelBefore,
    between: first.hotelAfter || second.hotelBefore,
    after: second.hotelAfter,
    requestingFlight: first.requestingFlight || second.requestingFlight,
    needsPower: (first.needsPower ?? false) || (second.needsPower ?? false),
  };
}

/** Writes a group's answers back as per-contest answers. */
export function writeGroup(group: ContestGroup, answers: GroupAnswers): Record<string, ContestAnswers> {
  const shared = { requestingFlight: answers.requestingFlight, needsPower: answers.needsPower };
  if (group.kind === 'single') {
    return { [group.contest.id]: { hotelBefore: answers.before, hotelAfter: answers.after, ...shared } };
  }
  return {
    [group.first.id]: { hotelBefore: answers.before, hotelAfter: answers.between, ...shared },
    [group.second.id]: { hotelBefore: answers.between, hotelAfter: answers.after, ...shared },
  };
}
