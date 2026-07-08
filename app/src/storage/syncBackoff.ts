/**
 * Retry backoff schedule for the sync layer — pure, so the progression is
 * unit-testable. Transient failures (offline, 5xx, 429) are retried after an
 * exponentially growing delay, capped so a long outage doesn't push retries
 * hours apart. attempt 0 is the first retry.
 */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 30000;

/**
 * Delay before retry `attempt` (0-based): base · 2^attempt, capped. Deterministic
 * by design; the engine may add jitter when it schedules, so the pure schedule
 * stays easy to assert against.
 */
export function backoffDelay(attempt: number, base = BACKOFF_BASE_MS, cap = BACKOFF_CAP_MS): number {
  if (attempt <= 0) return Math.min(base, cap);
  return Math.min(cap, base * 2 ** attempt);
}
