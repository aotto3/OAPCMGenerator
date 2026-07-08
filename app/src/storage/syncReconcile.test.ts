import { describe, expect, it } from 'vitest';
import { planReconciliation, resolveDirection } from './syncReconcile';

const T1 = '2026-07-07T12:00:00.000Z';
const T2 = '2026-07-08T12:00:00.000Z';

describe('resolveDirection (last-write-wins per contest)', () => {
  it('pushes a local-only contest', () => {
    expect(resolveDirection(T1, undefined)).toBe('push');
  });

  it('pulls a remote-only contest', () => {
    expect(resolveDirection(undefined, T1)).toBe('pull');
  });

  it('pushes when local is newer', () => {
    expect(resolveDirection(T2, T1)).toBe('push');
  });

  it('pulls when remote is newer', () => {
    expect(resolveDirection(T1, T2)).toBe('pull');
  });

  it('does nothing when the timestamps agree', () => {
    expect(resolveDirection(T1, T1)).toBe('none');
  });

  it('does nothing when neither side has it', () => {
    expect(resolveDirection(undefined, undefined)).toBe('none');
  });
});

describe('planReconciliation', () => {
  it('classifies every id across both lists', () => {
    const local = [
      { id: 'local-only', updatedAt: T1 },
      { id: 'local-newer', updatedAt: T2 },
      { id: 'in-sync', updatedAt: T1 },
      { id: 'local-older', updatedAt: T1 },
    ];
    const remote = [
      { id: 'remote-only', updatedAt: T1 },
      { id: 'local-newer', updatedAt: T1 },
      { id: 'in-sync', updatedAt: T1 },
      { id: 'local-older', updatedAt: T2 },
    ];

    const plan = planReconciliation(local, remote);

    expect(plan.push.sort()).toEqual(['local-newer', 'local-only']);
    expect(plan.pull.sort()).toEqual(['local-older', 'remote-only']);
  });

  it('handles empty sides', () => {
    expect(planReconciliation([], [])).toEqual({ push: [], pull: [] });
    expect(planReconciliation([{ id: 'a', updatedAt: T1 }], [])).toEqual({ push: ['a'], pull: [] });
    expect(planReconciliation([], [{ id: 'b', updatedAt: T1 }])).toEqual({ push: [], pull: ['b'] });
  });

  it('does not double-count an id present on both sides', () => {
    const plan = planReconciliation([{ id: 'a', updatedAt: T2 }], [{ id: 'a', updatedAt: T1 }]);
    expect(plan.push).toEqual(['a']);
    expect(plan.pull).toEqual([]);
  });
});
