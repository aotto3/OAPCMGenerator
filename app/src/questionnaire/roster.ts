/**
 * Judge roster projection (PRD #252). Turns the account's contests into the small
 * roster the server holds so the public questionnaire can find a judge by email.
 *
 * This is the only contest-derived data the server can read, so it is kept to the
 * minimum the page needs: each upcoming contest's id, title, level, date, host and
 * CM email, and each judge's normalized email, name and contest ids. Nothing else
 * about a judge (address, phone, bio, needs, contracting) ever leaves the device here.
 *
 * Pure: `today` (YYYY-MM-DD) is injected, never read from the clock.
 */
import { activeJudges, effectiveContestTitle, type Contest } from '../model/contest';
import { normalizeEmail } from '../model/judgePanel';

export interface RosterContest {
  id: string;
  title: string;
  level: string;
  /** ISO date or '' while undated. */
  date: string;
  host: string;
  cmEmail: string;
}

export interface RosterJudge {
  /** Trimmed and lower-cased; the lookup key. */
  email: string;
  name: string;
  /** In roster contest order. */
  contestIds: string[];
}

export interface JudgeRoster {
  contests: RosterContest[];
  judges: RosterJudge[];
}

/** Moved to the judge panel (RFC #267); re-exported for questionnaire callers. */
export { normalizeEmail };

/** Upcoming = not archived and dated today or later, or not dated yet. */
function isUpcoming(contest: Contest, today: string): boolean {
  if (contest.archived) return false;
  const date = contest.details.contestDate.trim();
  return date === '' || date >= today;
}

/** Dated contests by date, undated ones last; ties keep a stable id order. */
function byDate(a: Contest, b: Contest): number {
  const da = a.details.contestDate.trim();
  const db = b.details.contestDate.trim();
  if (da !== db) {
    if (da === '') return 1;
    if (db === '') return -1;
    return da < db ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildJudgeRoster(contests: Contest[], today: string): JudgeRoster {
  const upcoming = contests.filter((c) => isUpcoming(c, today)).sort(byDate);
  const judges = new Map<string, RosterJudge>();

  for (const contest of upcoming) {
    for (const judge of activeJudges(contest)) {
      const email = normalizeEmail(judge.email);
      if (email === '') continue;
      const entry = judges.get(email) ?? { email, name: '', contestIds: [] };
      if (entry.name === '') entry.name = judge.name.trim();
      if (!entry.contestIds.includes(contest.id)) entry.contestIds.push(contest.id);
      judges.set(email, entry);
    }
  }

  return {
    contests: upcoming.map((c) => ({
      id: c.id,
      title: effectiveContestTitle(c),
      level: c.identity.contestLevel,
      date: c.details.contestDate.trim(),
      host: c.identity.hostSchoolName.trim(),
      cmEmail: normalizeEmail(c.cmInfo.email),
    })),
    judges: [...judges.values()],
  };
}
