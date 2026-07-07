import { describe, expect, it } from 'vitest';
import { createContest, setNumSchools, withDetails, withSchool, type Contest, type CritiqueFormat } from './contest';
import { critiqueDistribution, generateCritiqueAssignments, type Rng } from './critique';

const NOW = '2026-07-05T12:00:00.000Z';

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

function makeContest(format: CritiqueFormat, n: number, numJudges: number): Contest {
  let c = createContest({ id: 'crit-test', now: NOW });
  c = setNumSchools(c, n);
  c = withDetails(c, { critiqueFormat: format, numJudges }, NOW);
  for (let i = 0; i < n; i++) {
    c = withSchool(c, i, { name: `School ${String.fromCharCode(65 + i)}`, performanceOrder: i + 1 }, NOW);
  }
  return c;
}

/** Every school gets exactly one judge in 1..J. */
function assertWellFormed(result: number[], n: number, j: number) {
  expect(result).toHaveLength(n);
  for (const judge of result) {
    expect(Number.isInteger(judge)).toBe(true);
    expect(judge).toBeGreaterThanOrEqual(1);
    expect(judge).toBeLessThanOrEqual(j);
  }
}

describe('generateCritiqueAssignments — distribution', () => {
  it('Judge 1 gets floor(N/J); remainder is spread across judges 2..J (J1 gets fewer)', () => {
    // N=6, J=3 → J1=2, remainder 4 split as 2/2 across J2,J3.
    const c = makeContest('after_all', 6, 3);
    for (let seed = 1; seed <= 40; seed++) {
      const result = generateCritiqueAssignments(c, seededRng(seed));
      const counts = critiqueDistribution(result, 3);
      assertWellFormed(result, 6, 3);
      expect(counts[0]).toBe(2); // floor(6/3)
      expect(counts[0] + counts[1] + counts[2]).toBe(6);
      // Judge 1 never gets MORE than the others.
      expect(counts[0]).toBeLessThanOrEqual(Math.min(counts[1], counts[2]));
    }
  });

  it('when N is not divisible by J, the extra critiques go to judges 2..J, not Judge 1', () => {
    // N=7, J=3 → J1=floor(7/3)=2, remaining 5 across J2,J3 → base 2, one gets +1 → {2,3} or {3,2}.
    const c = makeContest('after_all', 7, 3);
    for (let seed = 1; seed <= 40; seed++) {
      const counts = critiqueDistribution(generateCritiqueAssignments(c, seededRng(seed)), 3);
      expect(counts[0]).toBe(2);
      expect(counts.slice(1).sort()).toEqual([2, 3]); // remainder landed on an "other" judge
      expect(counts[0] + counts[1] + counts[2]).toBe(7);
    }
  });

  it('other-judge quotas differ by at most one (remainder spread evenly)', () => {
    // N=8, J=3 → J1=2, remaining 6 across J2,J3 → {3,3}.
    const c = makeContest('after_all', 8, 3);
    const counts = critiqueDistribution(generateCritiqueAssignments(c, seededRng(5)), 3);
    expect(counts[0]).toBe(2);
    expect(Math.abs(counts[1] - counts[2])).toBeLessThanOrEqual(1);
    expect(counts[1] + counts[2]).toBe(6);
  });
});

describe('generateCritiqueAssignments — after_each last-school constraint', () => {
  it('never assigns the last-performing school to Judge 1 (J ≥ 2)', () => {
    for (const [n, j] of [
      [3, 2],
      [6, 3],
      [7, 3],
      [8, 3],
      [4, 2],
    ] as const) {
      const c = makeContest('after_each', n, j);
      for (let seed = 1; seed <= 60; seed++) {
        const result = generateCritiqueAssignments(c, seededRng(seed));
        assertWellFormed(result, n, j);
        expect(result[n - 1]).not.toBe(1); // last position is never Judge 1
      }
    }
  });

  it('after_all mode places NO such constraint — Judge 1 may take the last school', () => {
    const c = makeContest('after_all', 6, 3);
    const lastIsJudge1 = Array.from({ length: 80 }, (_, s) => generateCritiqueAssignments(c, seededRng(s + 1)))
      .some((r) => r[r.length - 1] === 1);
    expect(lastIsJudge1).toBe(true); // at least one seed lets Judge 1 take the last school
  });
});

describe('generateCritiqueAssignments — edge cases', () => {
  it('J = 1 assigns every school to Judge 1, even in after_each (constraint needs ≥ 2 judges)', () => {
    const c = makeContest('after_each', 5, 1);
    const result = generateCritiqueAssignments(c, seededRng(3));
    expect(result).toEqual([1, 1, 1, 1, 1]);
  });

  it('minimum schools (3) with 2 judges: J1 gets 1, the other gets 2', () => {
    const c = makeContest('after_all', 3, 2);
    const counts = critiqueDistribution(generateCritiqueAssignments(c, seededRng(9)), 2);
    expect(counts[0]).toBe(1); // floor(3/2)
    expect(counts[1]).toBe(2);
  });

  it('maximum schools (8) evenly divides across 2 judges (4 each)', () => {
    const c = makeContest('after_all', 8, 2);
    const counts = critiqueDistribution(generateCritiqueAssignments(c, seededRng(2)), 2);
    expect(counts).toEqual([4, 4]);
  });

  it('is deterministic for a given seed (the STORED result is what persists)', () => {
    const c = makeContest('after_each', 6, 3);
    const a = generateCritiqueAssignments(c, seededRng(1234));
    const b = generateCritiqueAssignments(c, seededRng(1234));
    expect(a).toEqual(b);
  });
});
