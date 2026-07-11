/**
 * Unit tests for the in-memory rate limiter, driven by an injected clock so
 * allow/deny/reset is deterministic: it allows up to the limit per key, denies
 * past it (without recording the denied hit), resets after the window, and keeps
 * keys independent.
 */
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/rateLimiter';

/** A limiter over a mutable clock the test advances by hand. */
function withClock(limit: number, windowMs: number) {
  let t = 1_000_000;
  const limiter = createRateLimiter({ limit, windowMs, now: () => t });
  return { limiter, advance: (ms: number) => (t += ms) };
}

describe('createRateLimiter', () => {
  it('allows up to the limit then denies within the window', () => {
    const { limiter } = withClock(3, 1000);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
    expect(limiter.tryAcquire('a')).toBe(false);
  });

  it('resets once the window has passed', () => {
    const { limiter, advance } = withClock(1, 1000);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
    advance(1001); // slide past the window
    expect(limiter.tryAcquire('a')).toBe(true);
  });

  it('slides continuously — an old hit ages out mid-stream', () => {
    const { limiter, advance } = withClock(2, 1000);
    expect(limiter.tryAcquire('a')).toBe(true); // t=0 in-window
    advance(600);
    expect(limiter.tryAcquire('a')).toBe(true); // t=600
    expect(limiter.tryAcquire('a')).toBe(false); // 2 within 1000ms
    advance(500); // now t=1100; the first hit (t=0 relative) has aged out
    expect(limiter.tryAcquire('a')).toBe(true);
  });

  it('keeps separate keys independent', () => {
    const { limiter } = withClock(1, 1000);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('b')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
    expect(limiter.tryAcquire('b')).toBe(false);
  });

  it('does not consume budget on a denied attempt', () => {
    const { limiter, advance } = withClock(1, 1000);
    expect(limiter.tryAcquire('a')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
    expect(limiter.tryAcquire('a')).toBe(false);
    // Only the first hit counts; after the window one more is allowed immediately.
    advance(1001);
    expect(limiter.tryAcquire('a')).toBe(true);
  });
});
