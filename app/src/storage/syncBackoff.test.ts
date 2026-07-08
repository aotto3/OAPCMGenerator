import { describe, expect, it } from 'vitest';
import { BACKOFF_CAP_MS, backoffDelay } from './syncBackoff';

describe('backoffDelay', () => {
  it('grows exponentially from the base', () => {
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(1)).toBe(2000);
    expect(backoffDelay(2)).toBe(4000);
    expect(backoffDelay(3)).toBe(8000);
  });

  it('caps the delay so a long outage does not push retries hours apart', () => {
    expect(backoffDelay(10)).toBe(BACKOFF_CAP_MS);
    expect(backoffDelay(100)).toBe(BACKOFF_CAP_MS);
  });

  it('treats non-positive attempts as the first retry', () => {
    expect(backoffDelay(-5)).toBe(1000);
  });

  it('honors injected base and cap', () => {
    expect(backoffDelay(0, 500, 4000)).toBe(500);
    expect(backoffDelay(4, 500, 4000)).toBe(4000);
  });
});
