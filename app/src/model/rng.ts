/**
 * Random-permutation primitive — the shared, injected-RNG core both pure
 * randomizers in this layer build on (model/draw.ts's blind draw and
 * model/critique.ts's judge distribution).
 *
 * PURE MODULE. No React, no DOM, no IndexedDB, no fetch. A random source in
 * [0, 1) (Math.random's contract) is injected so every caller is deterministic
 * under test; production passes Math.random. The Fisher–Yates shuffle lives here
 * once — the off-by-one bound and swap both randomizers previously duplicated —
 * so there is a single tested home for "a deterministic-under-injection random
 * permutation".
 */

/** A random source in [0, 1), same contract as Math.random. Injected for tests. */
export type Rng = () => number;

/**
 * Fisher–Yates shuffle, in place, using the injected RNG. Walks from the last
 * index down to 1, swapping each element with a uniformly chosen earlier-or-self
 * index. Returns the same array reference for convenience.
 */
export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * A random permutation of the 1-based sequence 1..n. Edge cases: n ≤ 0 ⇒ `[]`;
 * n = 1 ⇒ `[1]`. Deterministic under an injected RNG, consuming `rng()` in
 * exactly Fisher–Yates order — so callers that persist the result (the blind
 * draw, the critique assignment) stay reproducible.
 */
export function randomPermutation(n: number, rng: Rng = Math.random): number[] {
  return shuffle(
    Array.from({ length: Math.max(0, n) }, (_, i) => i + 1),
    rng,
  );
}
