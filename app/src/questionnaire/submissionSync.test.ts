import { describe, expect, it } from 'vitest';
import { createContest, withAdjudicator, type Contest } from '../model/contest';
import type { SyncStatus } from '../storage/syncEngine';
import { blankAnswers, type JudgeSubmission } from './submission';
import { startSubmissionSync } from './submissionSync';

const NOW = '2026-11-01T12:00:00.000Z';

const judged = (id: string): Contest =>
  withAdjudicator(createContest({ id, now: NOW }), 0, { name: 'Jane', email: 'jane@x.org' }, NOW);

const SUB: JudgeSubmission = {
  email: 'jane@x.org',
  submittedAt: '2026-11-10T00:00:00.000Z',
  answers: { ...blankAnswers(['c1']), dietary: 'vegan' },
};

function harness(contests: Contest[], submissions: JudgeSubmission[] | Error) {
  let listener: (s: SyncStatus) => void = () => {};
  const store = new Map(contests.map((c) => [c.id, c]));
  const saved: Contest[] = [];
  let result = submissions;
  const stop = startSubmissionSync({
    subscribe: (l) => {
      listener = l;
      l('synced');
      return () => (listener = () => {});
    },
    fetchSubmissions: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
    contestIds: async () => [...store.keys()],
    // The library's transform: an identical result is a no-op.
    transform: async (id, fn) => {
      const fresh = store.get(id);
      if (!fresh) return undefined;
      const next = fn(fresh);
      if (next !== fresh) {
        saved.push(next);
        store.set(id, next);
      }
      return next;
    },
    now: () => '2026-11-20T00:00:00.000Z',
  });
  return {
    saved,
    stop,
    setResult: (r: JudgeSubmission[] | Error) => (result = r),
    async settle() {
      listener('syncing');
      listener('synced');
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe('startSubmissionSync', () => {
  it('applies submissions to matching contests after a sync pass and saves only those', async () => {
    const h = harness([judged('c1'), judged('c2')], [SUB]);
    await h.settle();
    expect(h.saved.map((c) => c.id)).toEqual(['c1']);
    expect(h.saved[0].adjudicators[0].dietary).toBe('vegan');
  });

  it('does nothing before a sync pass has run', async () => {
    const h = harness([judged('c1')], [SUB]);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.saved).toEqual([]);
  });

  it('does not save again once a submission is applied', async () => {
    const h = harness([judged('c1')], [SUB]);
    await h.settle();
    await h.settle();
    expect(h.saved).toHaveLength(1);
  });

  it('survives a failed fetch and retries at the next settle', async () => {
    const h = harness([judged('c1')], new Error('offline'));
    await h.settle();
    expect(h.saved).toEqual([]);
    h.setResult([SUB]);
    await h.settle();
    expect(h.saved).toHaveLength(1);
  });
});
