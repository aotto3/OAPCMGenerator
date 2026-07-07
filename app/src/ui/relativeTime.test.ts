import { describe, expect, it } from 'vitest';
import { relativeTime } from './relativeTime';

const NOW = new Date('2026-07-07T12:00:00.000Z');

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('reads "just now" for the last few seconds', () => {
    expect(relativeTime(ago(5 * SECOND), NOW)).toBe('just now');
  });

  it('singular vs plural minutes', () => {
    expect(relativeTime(ago(1 * MINUTE), NOW)).toBe('1 minute ago');
    expect(relativeTime(ago(2 * MINUTE), NOW)).toBe('2 minutes ago');
  });

  it('hours', () => {
    expect(relativeTime(ago(1 * HOUR), NOW)).toBe('1 hour ago');
    expect(relativeTime(ago(3 * HOUR), NOW)).toBe('3 hours ago');
  });

  it('days', () => {
    expect(relativeTime(ago(2 * DAY), NOW)).toBe('2 days ago');
  });

  it('falls back to an absolute date past ~30 days', () => {
    const iso = ago(90 * DAY);
    const expected = new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    expect(relativeTime(iso, NOW)).toBe(expected);
    // And it is a real date, not one of the relative phrases.
    expect(relativeTime(iso, NOW)).not.toContain('ago');
  });

  it('returns empty string for an unparseable timestamp', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
  });
});
