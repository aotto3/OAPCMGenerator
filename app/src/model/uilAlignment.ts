/**
 * UIL district alignment lookups. Pure: a contest and the bundled snapshot go in, the
 * filled-in contest comes out. Every conference uses the same fixed grid: 32 districts
 * numbered down eight columns of four, so a district's Bi-District partner, Area, and
 * Region follow from its number alone. The snapshot only supplies each district's
 * schools; scripts/refresh-uil-alignments.mjs regenerates it by hand.
 */
import {
  LEVEL_FIELDS,
  MAX_SCHOOLS,
  setNumSchools,
  type Classification,
  type Contest,
  type ContestIdentity,
  type LevelFieldKey,
  type School,
} from './contest';

export interface AlignmentSnapshot {
  /** The day the snapshot was taken, as YYYY-MM-DD. */
  asOf: string;
  /** UIL's label for the alignment period, e.g. "2026-2027". */
  schoolYear: string;
  /** Per conference, 32 districts in order (District 1 first), each a list of school names. */
  conferences: Record<Classification, string[][]>;
}

export const ALIGNMENT_DISTRICTS = 32;
const ALIGNMENT_AREAS = 8;

/** A level number typed into a box, or null when it isn't a whole number in range. */
function parseNumber(text: string, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= max ? n : null;
}

/** The Bi-District partner, Area, and Region a district sits in. */
export function districtPlacement(district: number): { partner: number; area: number; region: number } {
  return {
    partner: district % 2 === 1 ? district + 1 : district - 1,
    area: Math.ceil(district / 4),
    region: Math.ceil(district / 8),
  };
}

/** The level numbers implied by what's typed, for the fields the current level shows. */
export function derivedLevelNumbers(identity: ContestIdentity): Partial<Record<LevelFieldKey, string>> {
  const district = parseNumber(identity.district, ALIGNMENT_DISTRICTS);
  switch (identity.contestLevel) {
    case 'Zone':
      if (district === null) return {};
      return { area: String(districtPlacement(district).area), region: String(districtPlacement(district).region) };
    case 'BiDistrict': {
      if (district === null) return {};
      const { partner, area, region } = districtPlacement(district);
      return { districtSecond: String(partner), area: String(area), region: String(region) };
    }
    case 'Area': {
      const area = parseNumber(identity.area, ALIGNMENT_AREAS);
      return area === null ? {} : { region: String(Math.ceil(area / 2)) };
    }
    default:
      return {};
  }
}

/** The schools UIL aligns to a district, or null when the district isn't a valid number. */
export function districtSchools(
  snapshot: AlignmentSnapshot,
  classification: Classification,
  districtText: string,
): readonly string[] | null {
  const district = parseNumber(districtText, ALIGNMENT_DISTRICTS);
  if (district === null) return null;
  return snapshot.conferences[classification]?.[district - 1] ?? null;
}

/** Nothing but the name has been entered for this school. */
function onlyNamed(school: School): boolean {
  return (
    school.directors.every((d) => !d.name.trim() && !d.email.trim()) &&
    !school.playTitle.trim() &&
    school.roster.length === 0 &&
    !school.author.trim() &&
    !school.publisher.trim() &&
    !school.setting.trim() &&
    !school.runtime.trim() &&
    !school.musicCredits.trim()
  );
}

function sameNames(schools: readonly School[], names: readonly string[]): boolean {
  return schools.length >= names.length && schools.every((s, i) => s.name === (names[i] ?? ''));
}

/**
 * The district's schools may be written into this contest: it is a District contest and
 * its schools hold nothing yet except names that are blank or the ones UIL listed for
 * the previous district (so changing the district swaps an untouched fill).
 */
export function canFillDistrictSchools(contest: Contest, previousFill: readonly string[] | null): boolean {
  if (contest.identity.contestLevel !== 'District') return false;
  if (!contest.schools.every(onlyNamed)) return false;
  return contest.schools.every((s) => !s.name.trim()) || (!!previousFill && sameNames(contest.schools, previousFill));
}

/** Sets the school count to the chosen names (clamped to the allowed range) and fills them in order. */
export function withDistrictSchools(contest: Contest, names: readonly string[]): Contest {
  const sized = setNumSchools(contest, Math.min(names.length, MAX_SCHOOLS));
  return { ...sized, schools: sized.schools.map((s, i) => ({ ...s, name: names[i] ?? '' })) };
}

/**
 * Applies an identity edit's knock-on fills. A derived level number replaces a field
 * only while that field is blank or still holds what the previous values implied, so a
 * number someone typed is never overwritten. At District level a district with at most
 * MAX_SCHOOLS schools fills the school list the same way; a larger one is left for the
 * contest manager to pick from (see canFillDistrictSchools / withDistrictSchools).
 */
export function withAlignmentFill(previous: Contest, next: Contest, snapshot: AlignmentSnapshot): Contest {
  const before = derivedLevelNumbers(previous.identity);
  const after = derivedLevelNumbers(next.identity);
  const identity = { ...next.identity };
  let changed = false;
  for (const key of LEVEL_FIELDS[identity.contestLevel]) {
    const current = identity[key].trim();
    const wasDerived = before[key] !== undefined && current === before[key];
    if (after[key] === undefined && !wasDerived) continue;
    if (current && !wasDerived) continue;
    const value = after[key] ?? '';
    if (identity[key] !== value) {
      identity[key] = value;
      changed = true;
    }
  }
  let result = changed ? { ...next, identity } : next;

  const oldFill = districtSchools(snapshot, previous.identity.classification, previous.identity.district);
  const newFill = districtSchools(snapshot, result.identity.classification, result.identity.district);
  const previousFill = oldFill && oldFill.length <= MAX_SCHOOLS ? oldFill : null;
  if (newFill !== oldFill && canFillDistrictSchools(result, previousFill)) {
    if (newFill && newFill.length <= MAX_SCHOOLS) result = withDistrictSchools(result, newFill);
    else if (previousFill && sameNames(result.schools, previousFill)) {
      result = { ...result, schools: result.schools.map((s) => ({ ...s, name: '' })) };
    }
  }
  return result;
}

/** True once a snapshot taken on `asOf` is at least `months` calendar months old on `today` (both YYYY-MM-DD). */
export function snapshotIsStale(asOf: string, today: string, months = 11): boolean {
  const [y, m, d] = asOf.split('-').map(Number);
  const due = new Date(Date.UTC(y, m - 1 + months, d));
  return new Date(today + 'T00:00:00Z') >= due;
}
