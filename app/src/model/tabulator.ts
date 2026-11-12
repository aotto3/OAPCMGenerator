/**
 * Panel tabulator: a direct port of UIL's TTAO Tabulation Tool algorithm
 * (`rank.js` on uiltexas.org, "© 2021, Texas Theatre Adjudicators and Officials
 * TTAO"). PRD #236.
 *
 * PURE MODULE. Entries in, placed entries out; the input is never mutated.
 *
 * The port reproduces rank.js outcome-for-outcome, including its quirks, because
 * the CM's printout must never disagree with UIL's tool. A copy of rank.js lives
 * in `__fixtures__/uil-rank.js` and the tests compare the two on random ballots.
 *
 * For each place P (1..n), skipping places already filled:
 *   1. Majority: every unplaced entry ranked P or better by at least 2 of the 3
 *      judges is a candidate ("Majority of or better").
 *   2. No majority: the unplaced entries sharing the lowest total are the
 *      candidates ("Lowest Total").
 *   3. Candidates are placed in order of lowest total. Within a group sharing a
 *      total, exactly two are split head-to-head by how many judges preferred
 *      each ("Judge's Preference"); larger groups (or that fails) go to the
 *      reciprocal sum, rounded to 2 decimals ("Decimal Points"); a remaining
 *      tie goes to the Acting Judge's rank ("Tie broken by Acting Judge"), or
 *      stays an unbreakable tie when allowed (UIL: State only).
 *
 * Ranks are compared as numbers here; rank.js compares the raw input text in a
 * few places, which gives identical answers because a contest has at most 8
 * schools (single-digit ranks).
 */

export interface TabulatorEntry {
  /** Caller's identifier for the entry (the app passes the school form index). */
  key: number;
  /** [Acting Judge, Judge B, Judge C]; each judge's ranks are distinct 1..n. */
  ranks: readonly [number, number, number];
}

export interface TabulatedEntry {
  key: number;
  ranks: readonly [number, number, number];
  place: number;
  /** True for an entry in a tie broken by the Acting Judge (or unbreakable). UIL prints " - TIE". */
  tie: boolean;
  /** rank.js's internal diagnostic code, e.g. "1P-0T-S" (UIL shows it as a tooltip). */
  diagnosticCode: string;
  /** The Diagnostic column text, e.g. "Majority of or better". */
  diagnostic: string;
}

/** Mutable working record, mirroring rank.js's score objects. */
interface Work {
  key: number;
  ranks: readonly [number, number, number];
  cumulative: number;
  /** rank.js keeps this as toFixed(2) text and groups/compares on that text. */
  weighted: string;
  position: number;
  tie: boolean;
  diag: string;
}

/**
 * Tabulates a panel. Throws on a duplicate rank within one judge (as rank.js
 * does); callers validate first so this never fires in the app.
 */
export function tabulate(entries: readonly TabulatorEntry[], allowUnbreakableTies = false): TabulatedEntry[] {
  validate(entries);
  const scores: Work[] = entries.map((e) => {
    let cumulative = 0;
    let weighted = 0;
    for (const r of e.ranks) {
      cumulative += r;
      weighted += 100 / (r * 100);
    }
    return { key: e.key, ranks: e.ranks, cumulative, weighted: weighted.toFixed(2), position: 0, tie: false, diag: '' };
  });

  // rank.js sorts the shared array in place during candidate search; keep one
  // array and do the same so tie-group ordering matches.
  for (let i = 0; i < scores.length; i++) findPlace(i + 1, scores, allowUnbreakableTies);

  const placed = scores.map((s) => ({
    key: s.key,
    ranks: s.ranks,
    place: s.position,
    tie: s.tie,
    diagnosticCode: s.diag,
    diagnostic: diagnosticMessage(s.diag, allowUnbreakableTies),
  }));
  // Stable sort by place (rank.js's final sort).
  return placed.sort((a, b) => a.place - b.place);
}

function validate(entries: readonly TabulatorEntry[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    e.ranks.forEach((r, judge) => {
      const key = `${judge}-${r}`;
      if (seen.has(key)) throw new Error(`duplicate rank ${r} for judge ${judge + 1}`);
      seen.add(key);
    });
  }
}

function diagnosticMessage(diag: string, allowUnbreakableTies: boolean): string {
  const match = /^(\d+)P-(\d)+T-(.+)$/.exec(diag);
  if (!match) return '';
  const modifier = match[3];
  if (modifier === 'M') return 'Majority of or better';
  if (modifier.includes('S')) return 'Lowest Total';
  if (modifier.includes('B')) return allowUnbreakableTies ? 'Unbreakable Tie' : 'Tie broken by Acting Judge';
  if (modifier.includes('J')) return "Judge's Preference";
  if (modifier.includes('D')) return 'Decimal Points';
  return '';
}

function greatestPlace(scores: Work[]): number {
  return scores.reduce((max, s) => (s.position > max ? s.position : max), 0);
}

function findPlace(place: number, scores: Work[], allowUnbreakableTies: boolean): void {
  if (place <= greatestPlace(scores)) return;
  const result = findCandidates(place, scores);
  if (result === null) return;
  const [candidateType, candidates] = result;
  if (candidates.length === 1) {
    candidates[0].diag = `${place}P-0T-${candidateType}`;
    candidates[0].position = place;
    return;
  }
  findCumulativeWinner(candidateType, place, candidates, allowUnbreakableTies);
}

function findCandidates(place: number, scores: Work[]): ['M' | 'S', Work[]] | null {
  const majority: Work[] = [];
  for (const s of scores) {
    if (s.position > 0) continue;
    const count = s.ranks.filter((r) => r <= place).length;
    if (count > 1) majority.push(s);
  }
  if (majority.length === 0) {
    const groups = cumulativeGroups(scores);
    if (groups.length === 0) return null;
    return ['S', groups[0]];
  }
  return ['M', majority];
}

/**
 * rank.js's findCumulativeKeyed: sorts the array in place (descending total, as
 * written) and groups unplaced entries by total. It then walks the groups via
 * Object.keys, which visits integer keys in ascending order, so the groups come
 * out lowest total first, each group in the sorted array's order.
 */
function cumulativeGroups(candidates: Work[]): Work[][] {
  candidates.sort((a, b) => (a.cumulative === b.cumulative ? 0 : a.cumulative < b.cumulative ? 1 : -1));
  const groups = new Map<number, Work[]>();
  for (const c of candidates) {
    if (c.position > 0) continue;
    const group = groups.get(c.cumulative);
    if (group) group.push(c);
    else groups.set(c.cumulative, [c]);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((k) => groups.get(k)!);
}

function findCumulativeWinner(
  candidateType: 'M' | 'S',
  place: number,
  candidates: Work[],
  allowUnbreakableTies: boolean,
): void {
  const groups = cumulativeGroups(candidates);
  if (groups.length === 0) throw new Error(`Didn't find any cumulative winner for place ${place}`);

  let finalPlace = place;
  for (const winners of groups) {
    if (winners.length > 1) {
      if (winners.length === 2 && judgesPreference(candidateType, candidates.length, finalPlace, winners[0], winners[1])) {
        finalPlace += 2;
        continue;
      }
      findWeightedWinner(finalPlace, winners, allowUnbreakableTies);
    } else {
      winners[0].position = finalPlace;
      winners[0].diag = `${place}P-${candidates.length}T-MS`;
    }
    finalPlace += winners.length;
  }
}

/**
 * Head-to-head between two entries: the one more judges ranked higher wins.
 * With 3 judges and distinct ranks per judge this always decides (rank.js's
 * even-split branch calls an undefined breakTies() and is unreachable).
 */
function judgesPreference(candidateType: string, numTied: number, place: number, a: Work, b: Work): boolean {
  let aScores = 0;
  let bScores = 0;
  for (let i = 0; i < a.ranks.length; i++) {
    if (a.ranks[i] < b.ranks[i]) aScores++;
    else bScores++;
  }
  if (aScores === bScores) {
    a.tie = true;
    b.tie = true;
    throw new Error('Judges split evenly; rank.js cannot break this tie (requires an even number of judges).');
  }
  const type = candidateType === 'S' ? '' : candidateType;
  a.position = aScores > bScores ? place : place + 1;
  a.diag = `${place}P-${numTied}T-${type}J`;
  b.position = bScores > aScores ? place : place + 1;
  b.diag = `${place}P-${numTied}T-${type}J`;
  return true;
}

/**
 * Reciprocal-sum tiebreak. Groups by the 2-decimal text (so sums that differ
 * only past the second decimal tie, as in rank.js), highest first: those keys
 * are never integer-like, so rank.js visits them in insertion order, which is
 * its descending sort.
 */
function findWeightedWinner(place: number, candidates: Work[], allowUnbreakableTies: boolean): void {
  candidates.sort((a, b) => (a.weighted === b.weighted ? 0 : a.weighted < b.weighted ? 1 : -1));
  const groups = new Map<string, Work[]>();
  for (const c of candidates) {
    const group = groups.get(c.weighted);
    if (group) group.push(c);
    else groups.set(c.weighted, [c]);
  }

  let finalPlace = place;
  for (const [key, winners] of groups) {
    if (winners.length > 1) {
      if (winners.length === 2 && judgesPreference(key, candidates.length, finalPlace, winners[0], winners[1])) {
        finalPlace += 2;
        continue;
      }
      if (!allowUnbreakableTies) {
        // Acting Judge's rank decides (all positions are still unset here).
        winners.sort((a, b) => (a.ranks[0] > b.ranks[0] ? 1 : -1));
      }
      winners.forEach((w, i) => {
        w.tie = true;
        w.diag = `${place}P-${candidates.length}T-${winners[0].weighted}B`;
        w.position = allowUnbreakableTies ? finalPlace : finalPlace + i;
      });
      finalPlace += allowUnbreakableTies ? 1 : winners.length;
    } else {
      winners[0].position = finalPlace;
      winners[0].diag = `${place}P-${candidates.length}T-${winners[0].weighted}D`;
      finalPlace++;
    }
  }
}
