/**
 * Performance-order draw randomizer — the pure blind-draw algorithm.
 *
 * PURE MODULE. No React, no DOM, no IndexedDB, no fetch. A school count (plus an
 * injected RNG) goes in; a random permutation of 1..N comes out — the 1-based
 * performance-order slot drawn for each school (by form-order index). It runs
 * identically in the workspace UI and in tests; the STORED result is what
 * persists (contest.ts's runDraw writes it into the schools' performanceOrder
 * fields and records it in the contest's draw record).
 *
 * UIL requires the performance order to come from a blind draw. The shuffle
 * itself is the shared Fisher–Yates primitive in model/rng.ts, which
 * model/critique.ts's judge distribution also uses.
 */
import { randomPermutation, type Rng } from './rng';

/** Re-exported so existing `import { type Rng } from './draw'` keeps working. */
export type { Rng };

/**
 * A blind draw for N schools: a random permutation of 1..N. `result[i]` is the
 * 1-based performance-order slot drawn for the school at form-order index i.
 *
 * Deterministic under an injected RNG. Edge cases: N ≤ 0 ⇒ `[]`; N = 1 ⇒ `[1]`
 * (a single school always draws slot 1).
 */
export function drawOrder(n: number, rng: Rng = Math.random): number[] {
  return randomPermutation(n, rng);
}
