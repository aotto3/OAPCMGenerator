/**
 * Creating and finding the other zone of a Zone 1 / Zone 2 pair (PRD #220). Pure:
 * the UI (ui/sections/CreateSiblingZoneControl.tsx) persists and opens the results.
 */
import {
  createContest,
  type Contest,
  type ContestDetails,
  type ContestIdentity,
  type NewFromExistingOptions,
} from './contest';

/**
 * The details that belong to one zone's date. Unlike duplicate and advance, clock
 * times stay: zones of one district usually run the same schedule on different days.
 * The day 1 count goes back to the default split because the school count may differ.
 */
const CLEARED_SIBLING_DETAILS = {
  contestDate: '',
  rehearsalDate1: '',
  rehearsalDate2: '',
  rehearsalDay1Count: null,
  entrySystemDeadline: '',
  lightCueDeadlineDate: '',
  bidcContestDate: '',
} as const satisfies Partial<ContestDetails>;

/** The other zone's number, or null unless this is a Zone contest numbered 1 or 2. */
export function siblingZoneNumber(identity: ContestIdentity): '1' | '2' | null {
  if (identity.contestLevel !== 'Zone') return null;
  const zone = identity.zone.trim();
  if (zone === '1') return '2';
  if (zone === '2') return '1';
  return null;
}

/**
 * Returns the sibling zone as a new contest, or null when there is no sibling
 * number. Starts from a new contest and carries only what stays the same between
 * zones, so anything not named here (schools, draw, critique, results, next-level
 * info, readiness check-offs, judge preferences, custom title, archived flag,
 * Speechwire credentials) starts blank. The schedule ignores a carried break anchored
 * to a show the new contest doesn't have. Changing the new contest's school count
 * clears its breaks, as it does on any contest (setNumSchools).
 */
export function createSiblingZone(contest: Contest, options: NewFromExistingOptions = {}): Contest | null {
  const zone = siblingZoneNumber(contest.identity);
  if (zone === null) return null;
  return {
    ...createContest({ id: options.id, now: options.now, identity: { ...contest.identity, zone } }),
    cmInfo: { ...contest.cmInfo },
    details: { ...contest.details, ...CLEARED_SIBLING_DETAILS },
    adjudicators: contest.adjudicators.map((judge) => ({ ...judge })),
    customComplianceItems: contest.customComplianceItems.map((item) => ({ ...item })),
    customReadinessItems: contest.customReadinessItems.map((item) => ({ ...item })),
    documents: { ...contest.documents },
    scheduleOverrides: {
      ...contest.scheduleOverrides,
      gaps: contest.scheduleOverrides.gaps.map((gap) => ({ ...gap })),
    },
  };
}

/** The fields a contest needs for sibling matching; the dashboard summary has them. */
export interface SiblingCandidate {
  id: string;
  archived: boolean;
  contestLevel: string;
  contestYear: string;
  classification: string;
  district: string;
  zone: string;
}

/**
 * Other contests that are this contest's sibling zone: Zone level, not archived,
 * with the same year, classification, and district, and the other zone number.
 * Region and area don't count, because they are often blank on one side. A blank
 * district never matches. The open contest's own row is excluded by id, because it
 * can lag a zone number edit still waiting on autosave.
 */
export function findSiblingZones<T extends SiblingCandidate>(
  contest: Pick<Contest, 'id' | 'identity'>,
  candidates: readonly T[],
): T[] {
  const { identity } = contest;
  const zone = siblingZoneNumber(identity);
  const district = identity.district.trim();
  if (zone === null || district === '') return [];
  return candidates.filter(
    (c) =>
      c.id !== contest.id &&
      !c.archived &&
      c.contestLevel === 'Zone' &&
      c.contestYear.trim() === identity.contestYear.trim() &&
      c.classification === identity.classification &&
      c.district.trim() === district &&
      c.zone.trim() === zone,
  );
}
