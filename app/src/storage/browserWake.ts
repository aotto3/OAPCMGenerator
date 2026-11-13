/**
 * The production `wake` port (RFC #276, slice A3 #279): the tab coming back
 * into view or focus, and a periodic tick while it is visible. The library's sync
 * turns a wake into a throttled reconcile, which is what brings judges'
 * questionnaire answers into an open tab without any edit; the contest library
 * turns it into a retry of any follower whose last run failed.
 *
 * One set of DOM listeners and one interval serve every subscriber, and they
 * exist only while someone is subscribed.
 */

/** How often a visible tab wakes on its own. */
export const WAKE_TICK_MS = 3 * 60_000;

const listeners = new Set<() => void>();
let detach: (() => void) | undefined;

function fire(): void {
  for (const listener of [...listeners]) listener();
}

function attach(): () => void {
  const visible = () => document.visibilityState === 'visible';
  const onVisibility = () => {
    if (visible()) fire();
  };
  const tick = setInterval(() => {
    if (visible()) fire();
  }, WAKE_TICK_MS);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', fire);
  return () => {
    clearInterval(tick);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', fire);
  };
}

export function browserWake(listener: () => void): () => void {
  listeners.add(listener);
  detach ??= attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detach) {
      detach();
      detach = undefined;
    }
  };
}
