import { describe, expect, it } from 'vitest';
import {
  addAwardWinner,
  createContest,
  setAdvancing,
  setAlternate,
  setBestCrew,
  setNumSchools,
  setOutstandingTechnician,
  withSchool,
  type Contest,
} from './contest';
import { resolveResults } from './results';

const NOW = '2026-07-05T12:00:00.000Z';

/** A contest with six named schools (index 0..5), each with a play title. */
function namedContest(): Contest {
  let c = createContest({ id: 'test', now: NOW });
  ['Alpha HS', 'Bravo HS', 'Charlie HS', 'Delta HS', 'Echo HS', 'Foxtrot HS'].forEach((name, i) => {
    c = withSchool(c, i, { name, playTitle: `Play ${i}` }, NOW);
  });
  return c;
}

describe('resolveResults', () => {
  it('returns null when no results are recorded (the Awards Script blank-fallback signal)', () => {
    expect(resolveResults(namedContest())).toBeNull();
  });

  it('resolves advancing companies UNORDERED — the stored rank order never leaks', () => {
    // Stored RANK order: Echo (idx 4) 1st, Bravo (1) 2nd, Charlie (2) 3rd.
    const c = setAdvancing(namedContest(), [4, 1, 2], NOW);
    const r = resolveResults(c)!;
    // Output is school form order, NOT rank order — the 1st-place company (Echo)
    // is not surfaced first, so no placement can be read off the list.
    expect(r.advancing.map((a) => a.schoolName)).toEqual(['Bravo HS', 'Charlie HS', 'Echo HS']);
    expect(r.advancing[0].play).toBe('Play 1');
  });

  it('resolves the alternate, acting awards, technicians, and best crew', () => {
    let c = namedContest();
    c = setAdvancing(c, [0, 1, 2], NOW);
    c = setAlternate(c, 3, NOW);
    c = addAwardWinner(c, 'bestPerformers', { studentName: 'Ada', schoolIndex: 0 }, NOW);
    c = addAwardWinner(c, 'allStarCast', { studentName: 'Ben', schoolIndex: 1 }, NOW);
    c = addAwardWinner(c, 'honorableMention', { studentName: 'Cy', schoolIndex: 2 }, NOW);
    c = setOutstandingTechnician(c, 4, 'Devi', NOW);
    c = setBestCrew(c, 5, NOW);

    const r = resolveResults(c)!;
    expect(r.alternate).toEqual({ schoolName: 'Delta HS', play: 'Play 3' });
    expect(r.bestPerformers).toEqual([{ studentName: 'Ada', schoolName: 'Alpha HS' }]);
    expect(r.allStarCast).toEqual([{ studentName: 'Ben', schoolName: 'Bravo HS' }]);
    expect(r.honorableMention).toEqual([{ studentName: 'Cy', schoolName: 'Charlie HS' }]);
    expect(r.outstandingTechnicians).toEqual([{ studentName: 'Devi', schoolName: 'Echo HS' }]);
    expect(r.bestCrew).toEqual({ schoolName: 'Foxtrot HS', play: 'Play 5' });
  });

  it('resolves a partial record — unset categories stay empty/null', () => {
    const r = resolveResults(setAdvancing(namedContest(), [0], NOW))!;
    expect(r.advancing).toHaveLength(1);
    expect(r.alternate).toBeNull();
    expect(r.bestPerformers).toEqual([]);
    expect(r.allStarCast).toEqual([]);
    expect(r.outstandingTechnicians).toEqual([]);
    expect(r.bestCrew).toBeNull();
  });

  it('resolves a fully-capped record (2 Best Performers, 8 All-Star, 8 HM, per-school technicians)', () => {
    let c = namedContest();
    for (let i = 0; i < 2; i++) c = addAwardWinner(c, 'bestPerformers', { studentName: `BP${i}`, schoolIndex: i }, NOW);
    for (let i = 0; i < 8; i++) c = addAwardWinner(c, 'allStarCast', { studentName: `AS${i}`, schoolIndex: i % 6 }, NOW);
    for (let i = 0; i < 8; i++) c = addAwardWinner(c, 'honorableMention', { studentName: `HM${i}`, schoolIndex: i % 6 }, NOW);
    for (let i = 0; i < 6; i++) c = setOutstandingTechnician(c, i, `Tech${i}`, NOW);

    const r = resolveResults(c)!;
    expect(r.bestPerformers).toHaveLength(2);
    expect(r.allStarCast).toHaveLength(8);
    expect(r.honorableMention).toHaveLength(8);
    expect(r.outstandingTechnicians).toHaveLength(6);
    // Every resolved winner carries a real school name.
    expect(r.allStarCast.every((w) => w.schoolName !== '')).toBe(true);
  });

  it('drops stale / invalid school indices rather than rendering blanks', () => {
    let c = namedContest();
    // Record results referencing high indices while all six schools exist...
    c = setAdvancing(c, [0, 1, 2], NOW);
    c = addAwardWinner(c, 'allStarCast', { studentName: 'Ghost', schoolIndex: 5 }, NOW);
    c = setAlternate(c, 4, NOW);
    c = setBestCrew(c, 5, NOW);
    // ...then shrink to three schools, orphaning indices 3–5.
    c = setNumSchools(c, 3, NOW);

    const r = resolveResults(c)!;
    expect(r.advancing.map((a) => a.schoolName)).toEqual(['Alpha HS', 'Bravo HS', 'Charlie HS']);
    expect(r.allStarCast).toEqual([]); // school 5 gone ⇒ winner dropped
    expect(r.alternate).toBeNull(); // school 4 gone
    expect(r.bestCrew).toBeNull(); // school 5 gone
  });

  it('re-derives school names at read time — a rename flows through with no results edit', () => {
    let c = setAdvancing(namedContest(), [0], NOW);
    c = withSchool(c, 0, { name: 'Renamed HS' }, NOW);
    expect(resolveResults(c)!.advancing[0].schoolName).toBe('Renamed HS');
  });

  it('falls back to "School N" for a blank school name (docSchools convention)', () => {
    let c = withSchool(namedContest(), 2, { name: '' }, NOW); // clear Charlie's name
    c = setAdvancing(c, [2], NOW);
    expect(resolveResults(c)!.advancing[0].schoolName).toBe('School 3'); // form position 3
  });
});
