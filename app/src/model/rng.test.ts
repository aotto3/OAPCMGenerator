import { describe, expect, it } from 'vitest';
import { randomPermutation, shuffle, type Rng } from './rng';

/** Deterministic seeded RNG (mulberry32) so every assertion is reproducible. */
function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('shuffle — Fisher–Yates primitive', () => {
  it('is a permutation: same elements, same length', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle([...arr], seededRng(42));
    expect(out).toHaveLength(arr.length);
    expect([...out].sort((a, b) => a - b)).toEqual(arr);
  });

  it('shuffles in place and returns the same array reference', () => {
    const arr = [1, 2, 3];
    expect(shuffle(arr, seededRng(1))).toBe(arr);
  });

  it('is deterministic under an injected RNG (same seed ⇒ same result)', () => {
    expect(shuffle([1, 2, 3, 4, 5], seededRng(7))).toEqual(shuffle([1, 2, 3, 4, 5], seededRng(7)));
  });

  it('leaves empty and single-element arrays unchanged', () => {
    expect(shuffle([], seededRng(1))).toEqual([]);
    expect(shuffle([9], seededRng(1))).toEqual([9]);
  });
});

describe('randomPermutation — 1..n', () => {
  it('returns a permutation of 1..n for a range of sizes and seeds', () => {
    for (let n = 1; n <= 10; n++) {
      for (let seed = 1; seed <= 20; seed++) {
        const p = randomPermutation(n, seededRng(seed));
        expect(p).toHaveLength(n);
        expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      }
    }
  });

  it('edge cases: n ≤ 0 ⇒ [], n = 1 ⇒ [1]', () => {
    expect(randomPermutation(0, seededRng(1))).toEqual([]);
    expect(randomPermutation(-4, seededRng(1))).toEqual([]);
    expect(randomPermutation(1, seededRng(1))).toEqual([1]);
  });

  it('consumes rng() in Fisher–Yates order (pinned against a fixed RNG)', () => {
    // rng ≡ 0 forces every chosen index to 0: the exact swap sequence is pinned,
    // guarding the consumption order the persisted draw / critique results rely on.
    expect(randomPermutation(3, () => 0)).toEqual([2, 3, 1]);
    expect(randomPermutation(4, () => 0)).toEqual([2, 3, 4, 1]);
  });

  it('is deterministic under an injected RNG (same seed ⇒ same permutation)', () => {
    expect(randomPermutation(8, seededRng(1234))).toEqual(randomPermutation(8, seededRng(1234)));
  });

  it('defaults to Math.random when no RNG is injected (still a valid permutation)', () => {
    const p = randomPermutation(6);
    expect([...p].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
