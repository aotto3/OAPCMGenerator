import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tabulate, type TabulatorEntry } from './tabulator';

/**
 * The oracle: UIL's own rank.js (TTAO Tabulation Tool), kept verbatim in
 * __fixtures__. It is a browser UMD script that writes to `exports` when one is
 * in scope, so it is loaded by handing it an exports object.
 */
interface UilScore {
  name: string;
  scores: string[];
  position?: number;
  tie?: boolean;
  diag?: string;
  diagmsg?: string;
}
const uilSource = readFileSync(fileURLToPath(new URL('./__fixtures__/uil-rank.js', import.meta.url)), 'utf8');
const uil: { calculate: (scores: UilScore[], allowUnbreakableTies: boolean) => void } = {} as never;
new Function('exports', uilSource)(uil);

type Ballot = [number, number, number][];

/** Runs UIL's rank.js the way its page does (rank text from the inputs) and normalizes the result. */
function runUil(ballot: Ballot, allowUnbreakableTies = false) {
  const scores: UilScore[] = ballot.map((r, i) => ({ name: String(i), scores: r.map(String) }));
  uil.calculate(scores, allowUnbreakableTies);
  return scores.map((s) => ({
    key: Number(s.name),
    place: s.position,
    tie: Boolean(s.tie),
    diagnosticCode: s.diag,
    diagnostic: s.diagmsg,
  }));
}

function runOurs(ballot: Ballot, allowUnbreakableTies = false) {
  const entries: TabulatorEntry[] = ballot.map((ranks, key) => ({ key, ranks }));
  return tabulate(entries, allowUnbreakableTies).map(({ key, place, tie, diagnosticCode, diagnostic }) => ({
    key,
    place,
    tie,
    diagnosticCode,
    diagnostic,
  }));
}

function permutations(n: number): number[][] {
  if (n === 1) return [[1]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) {
    for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n, ...p.slice(i)]);
  }
  return out;
}

/** Ballot from three judges' rankings (judgeRanks[j][school] = rank). */
function ballotOf(a: number[], b: number[], c: number[]): Ballot {
  return a.map((_, i) => [a[i], b[i], c[i]]);
}

/** Small seeded PRNG (mulberry32) so a failing random case can be reproduced from its seed. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPermutation(n: number, rng: () => number): number[] {
  const p = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

describe('tabulate: the user sample (UIL printout)', () => {
  it('places School 3 by Lowest Total, then School 1 and School 2 by Majority', () => {
    // School 1 (2,3,1), School 2 (3,1,3), School 3 (1,2,2)
    const result = tabulate([
      { key: 0, ranks: [2, 3, 1] },
      { key: 1, ranks: [3, 1, 3] },
      { key: 2, ranks: [1, 2, 2] },
    ]);
    expect(result.map((r) => [r.key, r.place, r.diagnostic, r.tie])).toEqual([
      [2, 1, 'Lowest Total', false],
      [0, 2, 'Majority of or better', false],
      [1, 3, 'Majority of or better', false],
    ]);
  });

  it('does not mutate its input', () => {
    const entries: TabulatorEntry[] = [
      { key: 0, ranks: [2, 3, 1] },
      { key: 1, ranks: [3, 1, 3] },
      { key: 2, ranks: [1, 2, 2] },
    ];
    const copy = structuredClone(entries);
    tabulate(entries);
    expect(entries).toEqual(copy);
  });

  it('rejects a duplicate rank within one judge, as rank.js does', () => {
    expect(() =>
      tabulate([
        { key: 0, ranks: [1, 1, 1] },
        { key: 1, ranks: [1, 2, 2] },
        { key: 2, ranks: [3, 3, 3] },
      ]),
    ).toThrow(/duplicate rank 1 for judge 1/);
  });
});

describe('tabulate matches UIL rank.js', () => {
  const seenDiagnostics = new Set<string>();

  it('on every possible 3-school and 4-school ballot', () => {
    for (const n of [3, 4]) {
      const perms = permutations(n);
      for (const a of perms) {
        for (const b of perms) {
          for (const c of perms) {
            const ballot = ballotOf(a, b, c);
            const ours = runOurs(ballot);
            ours.forEach((r) => seenDiagnostics.add(r.diagnostic));
            expect(ours, JSON.stringify(ballot)).toEqual(runUil(ballot));
          }
        }
      }
    }
  });

  it('on random 5-to-8-school ballots (fresh seed every run)', () => {
    const seed = Date.now() % 2 ** 31;
    const rng = mulberry32(seed);
    for (let i = 0; i < 20000; i++) {
      const n = 5 + (i % 4);
      const ballot = ballotOf(randomPermutation(n, rng), randomPermutation(n, rng), randomPermutation(n, rng));
      const ours = runOurs(ballot);
      ours.forEach((r) => seenDiagnostics.add(r.diagnostic));
      expect(ours, `seed ${seed}, case ${i}: ${JSON.stringify(ballot)}`).toEqual(runUil(ballot));
    }
  });

  it('exercised every tie-breaking rule along the way', () => {
    expect([...seenDiagnostics].sort()).toEqual(
      ['Decimal Points', "Judge's Preference", 'Lowest Total', 'Majority of or better', 'Tie broken by Acting Judge'].sort(),
    );
  });

  it('also matches with unbreakable ties allowed (State rules, kept for parity)', () => {
    const rng = mulberry32(236);
    for (let i = 0; i < 3000; i++) {
      const n = 3 + (i % 6);
      const ballot = ballotOf(randomPermutation(n, rng), randomPermutation(n, rng), randomPermutation(n, rng));
      expect(runOurs(ballot, true), JSON.stringify(ballot)).toEqual(runUil(ballot, true));
    }
  });
});

describe('tabulate: one forced case per rule', () => {
  const diag = (ballot: Ballot) => tabulate(ballot.map((ranks, key) => ({ key, ranks })));

  it("Judge's Preference splits a 2-way total tie head-to-head", () => {
    // At place 2, entries 1 (3,2,2) and 2 (2,4,1) both have a majority and both
    // total 7; judges 1 and 3 prefer entry 2, so it takes 2nd.
    const r = diag([
      [4, 3, 3],
      [3, 2, 2],
      [2, 4, 1],
      [1, 1, 4],
    ]);
    expect(r.map((e) => [e.key, e.place, e.diagnostic])).toEqual([
      [3, 1, 'Majority of or better'],
      [2, 2, "Judge's Preference"],
      [1, 3, "Judge's Preference"],
      [0, 4, 'Majority of or better'],
    ]);
  });

  it('Acting Judge breaks a tie nothing else can, and marks the entries TIE', () => {
    // Cyclic ballot: every total 6, every reciprocal sum equal.
    const r = diag([
      [1, 2, 3],
      [2, 3, 1],
      [3, 1, 2],
    ]);
    expect(r.map((e) => [e.key, e.place, e.diagnostic, e.tie])).toEqual([
      [0, 1, 'Tie broken by Acting Judge', true],
      [1, 2, 'Tie broken by Acting Judge', true],
      [2, 3, 'Tie broken by Acting Judge', true],
    ]);
  });
});
