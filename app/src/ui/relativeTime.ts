/**
 * Pure relative-time formatter — "2 minutes ago", "3 hours ago", "2 days ago".
 * Used by the version-history panel; kept dependency-free (clock injected via
 * `now`) so it is unit-testable. Falls back to an absolute date past ~30 days,
 * matching v12's snapshot list which showed "Saved Mar 3, 2026".
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (isNaN(then.getTime())) return '';

  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
