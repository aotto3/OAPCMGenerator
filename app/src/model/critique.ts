/**
 * Critique assignment randomizer — the pure judge-distribution algorithm.
 *
 * PURE MODULE. No React, no DOM, no IndexedDB, no fetch. A contest record (plus
 * an injected RNG) goes in; a `judgeByPosition` array comes out — the 1-based
 * judge number assigned to each school, indexed by performance-order position.
 * It runs identically in the workspace UI and in tests; the STORED result is
 * what persists (setCritiqueAssignment writes it into the contest record),
 * matching v12 which freezes the locked result.
 *
 * Behavior spec: the v12 single-file app (_Templates/OAP Contest Setup.html),
 * generateCritiqueAssignments() (~line 3306). The distribution rules are ported
 * EXACTLY — do not "improve" them:
 *   • Judge 1 gets floor(N / J); the remainder is spread across judges 2..J
 *     (base = floor(remaining / (J-1)), a random subset gets +1). So Judge 1
 *     gets FEWER when N isn't evenly divisible by J.
 *   • after_each format: the LAST-performing school is never assigned to Judge 1
 *     (when there are ≥ 2 judges).
 *   • Which schools land with which judge is otherwise random.
 *
 * The RNG is injected so tests are deterministic; production passes Math.random.
 */

import { numSchools, type Contest } from './contest';

/** A random source in [0, 1), same contract as Math.random. Injected for tests. */
export type Rng = () => number;

/** Fisher–Yates shuffle in place (v12's shuffle), using the injected RNG. */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Per-judge quotas: index 0 is Judge 1's share (floor(N/J)); the rest split the
 * remainder as evenly as possible, with a random subset of judges 2..J getting
 * the extra +1. Returns a length-J array of counts summing to N.
 */
function judgeQuotas(n: number, j: number, rng: Rng): number[] {
  const judge1 = Math.floor(n / j);
  const remaining = n - judge1;
  const others = j - 1;
  const quotas = [judge1];
  if (others > 0) {
    const base = Math.floor(remaining / others);
    const extra = remaining % others;
    // Randomly choose which of the 'other' judges receive the +1 extras.
    const order = shuffle(
      Array.from({ length: others }, (_, x) => x),
      rng,
    );
    for (let k = 0; k < others; k++) quotas.push(base + (order[k] < extra ? 1 : 0));
  }
  return quotas;
}

/**
 * Runs the randomizer against a contest. Returns `judgeByPosition`: for each
 * school in performance order (position 0..N-1), the 1-based judge number
 * assigned to it. N is the school count and J is details.numJudges.
 *
 * Edge cases match v12: J = 1 assigns every school to Judge 1 (the after_each
 * constraint needs ≥ 2 judges to apply); N = 0 yields an empty array.
 */
export function generateCritiqueAssignments(contest: Contest, rng: Rng = Math.random): number[] {
  const n = numSchools(contest);
  const j = contest.details.numJudges;
  const afterEach = contest.details.critiqueFormat === 'after_each';

  const result = new Array<number>(n).fill(0);
  if (n === 0 || j < 1) return result;

  const quotas = judgeQuotas(n, j, rng);

  // after_each: the last-performing school must NOT go to Judge 1. Pre-assign it
  // to a randomly chosen eligible judge (2..J) that still has quota, then debit.
  if (afterEach && j >= 2) {
    const eligible: number[] = [];
    for (let jj = 1; jj < j; jj++) if (quotas[jj] > 0) eligible.push(jj);
    if (eligible.length > 0) {
      const picked = eligible[Math.floor(rng() * eligible.length)];
      result[n - 1] = picked + 1; // store 1-based
      quotas[picked]--;
    }
  }

  // Shuffle the still-unassigned positions and hand them out judge by judge.
  const pool: number[] = [];
  for (let i = 0; i < n; i++) if (result[i] === 0) pool.push(i);
  shuffle(pool, rng);

  let poolIdx = 0;
  for (let jk = 0; jk < j; jk++) {
    for (let c = 0; c < quotas[jk]; c++) {
      result[pool[poolIdx]] = jk + 1;
      poolIdx++;
    }
  }

  return result;
}

/**
 * Count of schools assigned to each judge. `counts[k]` is Judge (k+1)'s load;
 * length is `numJudges`. Drives the workspace summary and is the observable
 * output the distribution tests assert against.
 */
export function critiqueDistribution(judgeByPosition: number[], numJudges: number): number[] {
  const counts = new Array<number>(numJudges).fill(0);
  for (const j of judgeByPosition) {
    if (j >= 1 && j <= numJudges) counts[j - 1]++;
  }
  return counts;
}
