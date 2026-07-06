/**
 * Document text formatters — dates in the human-readable forms the generated
 * documents print.
 *
 * v12 formatted these with Date.prototype.toLocaleDateString('en-US', …), which
 * depends on the host's locale/ICU data and (for a bare `new Date()`) on the
 * clock. Both are hostile to golden-file comparison. These ports produce the
 * SAME en-US strings deterministically, from explicit month/weekday tables and
 * the date's local calendar components — no locale, no timezone drift. v12
 * anchored every parse at local noon (T12:00:00) so the day component is immune
 * to DST edges; that anchor is preserved.
 *
 * Pure. No DOM, no locale APIs.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Parses a yyyy-mm-dd string at local noon (v12's T12:00:00 anchor). '' / invalid ⇒ null. */
function parseIsoDate(ds: string): Date | null {
  if (!ds) return null;
  const d = new Date(ds + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

/** "July 6, 2026" from a Date's local components. v12's en-US month/day/year form. */
export function formatLongDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "July 6, 2026" — v12 fmtDateShort. '' in ⇒ '' out. */
export function fmtDateShort(ds: string): string {
  const d = parseIsoDate(ds);
  return d ? formatLongDate(d) : '';
}

/** "Monday, July 6, 2026" — v12 fmtDate (weekday + long date). '' in ⇒ '' out. */
export function fmtDate(ds: string): string {
  const d = parseIsoDate(ds);
  return d ? `${WEEKDAYS[d.getDay()]}, ${formatLongDate(d)}` : '';
}

/** "7/6/2026" — v12 fmtDateNumeric. '' in ⇒ '' out. */
export function fmtDateNumeric(ds: string): string {
  const d = parseIsoDate(ds);
  return d ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : '';
}
