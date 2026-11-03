import type { ContestSummary } from '../../storage/contestStore';

/** A bare ISO date in words. Noon keeps it on the same day in every time zone. */
function summaryDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(`${iso}T12:00:00`);
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'long' });
}

/** One line under a contest's name: its date and host, each only when present. */
export function contestSummaryMeta({ contestDate, hostSchoolName }: ContestSummary): string {
  const host = hostSchoolName.trim();
  return [summaryDate(contestDate), host ? `Host: ${host}` : ''].filter(Boolean).join(' · ');
}
