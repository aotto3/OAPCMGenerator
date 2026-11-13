/**
 * The questionnaire answer follower (slice A3 #279) on a real library over
 * fake-indexeddb. `pass()` is a completed server pass; edits go through the
 * library and settle without one.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createContest, type Contest } from '../model/contest';
import { setJudge } from '../model/judgePanel';
import { followerKit } from '../storage/followerTestKit';
import { blankAnswers, type JudgeSubmission } from './submission';
import { startSubmissionSync } from './submissionSync';

const NOW = '2026-11-01T12:00:00.000Z';

const judged = (id: string): Contest => setJudge(createContest({ id, now: NOW }), 0, { name: 'Jane', email: 'jane@x.org' }, NOW);

const SUB: JudgeSubmission = {
  email: 'jane@x.org',
  submittedAt: '2026-11-10T00:00:00.000Z',
  answers: { ...blankAnswers(['c1', 'c3']), dietary: 'vegan' },
};

async function harness(contests: Contest[], submissions: JudgeSubmission[] | Error) {
  const kit = followerKit();
  const { library } = kit;
  for (const contest of contests) await library.add(contest);
  const saved: string[] = [];
  library.subscribe((e) => {
    if (e.type === 'changed' && e.by === 'submissions') saved.push(e.id);
  });
  let result = submissions;
  let fetches = 0;
  const stop = startSubmissionSync({
    follow: (name, handler) => library.follow(name, handler),
    fetchSubmissions: async () => {
      fetches += 1;
      if (result instanceof Error) throw result;
      return result;
    },
    contestIds: async () => (await library.list()).map((s) => s.id),
    now: () => '2026-11-20T00:00:00.000Z',
  });
  return {
    kit,
    library,
    saved,
    stop,
    fetches: () => fetches,
    setResult: (r: JudgeSubmission[] | Error) => (result = r),
    /** A completed server pass, then everything settles. */
    pass: () => kit.pass(),
  };
}

describe('startSubmissionSync', () => {
  it('applies submissions to matching contests after a server pass and saves only those', async () => {
    const h = await harness([judged('c1'), judged('c2')], [SUB]);
    await h.pass();
    expect(h.saved).toEqual(['c1']);
    expect((await h.library.read('c1'))?.adjudicators[0].dietary).toBe('vegan');
  });

  it('does nothing before a server pass has completed', async () => {
    const h = await harness([judged('c1')], [SUB]);
    await h.library.save(setJudge(judged('c1'), 0, { name: 'Jane B' }, '2026-11-02T00:00:00.000Z'));
    await h.kit.settle();
    expect(h.fetches()).toBe(0);
    expect(h.saved).toEqual([]);
  });

  it('does not save again once a submission is applied', async () => {
    const h = await harness([judged('c1')], [SUB]);
    await h.pass();
    await h.pass();
    expect(h.saved).toHaveLength(1);
  });

  it('fetches only on a server pass; an edit applies the answers already fetched', async () => {
    const h = await harness([judged('c1')], [SUB]);
    await h.pass();
    expect(h.fetches()).toBe(1);
    // A new contest naming the same judge arrives on this device.
    await h.library.add(judged('c3'));
    await h.kit.settle();
    expect(h.fetches()).toBe(1);
    expect((await h.library.read('c3'))?.adjudicators[0].dietary).toBe('vegan');
  });

  it('retries a failed fetch at the next wake', async () => {
    const h = await harness([judged('c1')], new Error('offline'));
    await h.pass();
    expect(h.saved).toEqual([]);
    h.setResult([SUB]);
    h.kit.wake();
    await h.kit.settle();
    expect(h.saved).toEqual(['c1']);
  });
});
