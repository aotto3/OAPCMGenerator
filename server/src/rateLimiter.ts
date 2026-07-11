/**
 * A tiny in-memory, per-key rate limiter with an INJECTED clock — so its
 * allow/deny/reset behavior is deterministic under test. Used to gate the admin
 * resend-sign-in-link action per target email (N sends per rolling window) so it
 * can never spam a user, by accident or otherwise.
 *
 * Single-instance is sufficient for this deploy (one API process on Railway); a
 * multi-instance deploy would need a shared store, out of scope here. Nothing is
 * persisted — the limiter is advisory and resets on restart.
 */
export interface RateLimiter {
  /**
   * Records one hit for `key` and returns true if it is within the limit, or
   * returns false WITHOUT recording when the key is already at the limit for the
   * current rolling window.
   */
  tryAcquire(key: string): boolean;
}

export interface RateLimiterOptions {
  /** Max hits allowed per key within a window. */
  limit: number;
  /** Rolling window length in milliseconds. */
  windowMs: number;
  /** Injected clock (epoch ms). Defaults to Date.now. */
  now?: () => number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  // key -> ascending hit timestamps still inside the window.
  const hits = new Map<string, number[]>();

  return {
    tryAcquire(key) {
      const t = now();
      const cutoff = t - windowMs;
      const recent = (hits.get(key) ?? []).filter((ts) => ts > cutoff);
      if (recent.length >= limit) {
        // Keep the pruned list so memory doesn't grow with denied attempts.
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}
