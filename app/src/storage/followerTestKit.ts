/**
 * Test kit for contest-library followers (slice A3 #279): a real library on a
 * fresh fake-indexeddb, manual timers, a manual wake port, and `settle()`,
 * which fires due timers until everything has gone quiet. Test files must
 * `import 'fake-indexeddb/auto'` first (idb checks the global IDBRequest).
 */
import { IDBFactory } from 'fake-indexeddb';
import { createContestLibrary, type ContestLibrary, type Timers } from './contestLibrary';

export interface FollowerKit {
  library: ContestLibrary;
  /** Fires the wake port, as tab focus or the periodic tick would. */
  wake(): void;
  /** Fires timers and waits until no timer is pending and IndexedDB work has drained. */
  settle(): Promise<void>;
}

export function followerKit(clock: () => string = () => '2026-11-01T12:00:00.000Z'): FollowerKit {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers: Timers = {
    set(fn) {
      pending.set(++next, fn);
      return next;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  const wakeListeners = new Set<() => void>();
  const library = createContestLibrary({
    idb: new IDBFactory(),
    clock,
    timers,
    wake: (listener) => {
      wakeListeners.add(listener);
      return () => wakeListeners.delete(listener);
    },
  });
  return {
    library,
    wake() {
      for (const listener of [...wakeListeners]) listener();
    },
    async settle() {
      let quiet = 0;
      for (let i = 0; i < 500 && quiet < 25; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (pending.size === 0) {
          quiet += 1;
          continue;
        }
        quiet = 0;
        const due = [...pending.values()];
        pending.clear();
        for (const fn of due) fn();
      }
    },
  };
}
