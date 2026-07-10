import { describe, expect, it } from 'vitest';
import { drawOrder, type Rng } from './draw';

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

/** A valid draw is a permutation of 1..N: length N, each of 1..N exactly once. */
function assertPermutation(result: number[], n: number) {
  expect(result).toHaveLength(n);
  expect([...result].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
}

describe('drawOrder — valid permutation', () => {
  it('returns a permutation of 1..N for every contest size (3–8), over many seeds', () => {
    for (let n = 3; n <= 8; n++) {
      for (let seed = 1; seed <= 50; seed++) {
        assertPermutation(drawOrder(n, seededRng(seed)), n);
      }
    }
  });

  it('covers exactly N slots — no slot missing, none repeated (draws the whole field)', () => {
    const result = drawOrder(6, seededRng(42));
    assertPermutation(result, 6);
    expect(new Set(result).size).toBe(6);
  });
});

describe('drawOrder — deterministic under an injected RNG', () => {
  it('produces the same permutation for the same seed (the STORED result is what persists)', () => {
    const a = drawOrder(8, seededRng(1234));
    const b = drawOrder(8, seededRng(1234));
    expect(a).toEqual(b);
  });

  it('different seeds generally produce different permutations', () => {
    const orders = Array.from({ length: 20 }, (_, s) => drawOrder(8, seededRng(s + 1)).join(','));
    expect(new Set(orders).size).toBeGreaterThan(1);
  });
});

describe('drawOrder — edge cases', () => {
  it('N = 0 yields an empty array', () => {
    expect(drawOrder(0, seededRng(1))).toEqual([]);
  });

  it('negative N is treated as empty', () => {
    expect(drawOrder(-3, seededRng(1))).toEqual([]);
  });

  it('N = 1 always draws slot 1 (a single school)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(drawOrder(1, seededRng(seed))).toEqual([1]);
    }
  });

  it('defaults to Math.random when no RNG is injected (still a valid permutation)', () => {
    assertPermutation(drawOrder(6), 6);
  });
});
