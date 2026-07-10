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
 * UIL requires the performance order to come from a blind draw. This mirrors the
 * critique-assignment randomizer's shape (model/critique.ts): a pure generator
 * with an injected RNG so tests are deterministic; production passes Math.random.
 * The Fisher–Yates shuffle is the same one critique.ts uses.
 */

/** A random source in [0, 1), same contract as Math.random. Injected for tests. */
export type Rng = () => number;

/**
 * A blind draw for N schools: a random permutation of 1..N. `result[i]` is the
 * 1-based performance-order slot drawn for the school at form-order index i.
 *
 * Deterministic under an injected RNG. Edge cases: N ≤ 0 ⇒ `[]`; N = 1 ⇒ `[1]`
 * (a single school always draws slot 1). Fisher–Yates in place, matching
 * critique.ts's shuffle.
 */
export function drawOrder(n: number, rng: Rng = Math.random): number[] {
  const slots = Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}
