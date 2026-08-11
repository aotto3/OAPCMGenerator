import { computeContestDay, fmtTime, type ScheduleEvent } from '../model/schedule';
import { validateSchedule } from '../model/scheduleValidation';
import type { Contest } from '../model/contest';
import { Section } from './sections/Section';

/**
 * Live contest-day schedule preview (v12 updateSchedulePreview). Read-only: it
 * only reads the contest, so it re-renders on every relevant keystroke as the
 * Workspace's single Contest value changes. The pure engine does the math; this
 * component owns the presentation — the school color palette and the empty
 * state — which the engine deliberately does not.
 */

/** v12 SCHOOL_COLORS_HEX — the per-school row palette (presentation only). */
const SCHOOL_COLORS_HEX = ['#FEF2CB', '#B4C6E7', '#F4B083', '#C5E0B3', '#FFFF00', '#FFC000', '#E06666', '#CCA3FF'];
/** v12 THEME.xlsx.grey — the fill for admin / transition / critique rows. */
const GREY = '#DADADA';

function rowColor(ev: ScheduleEvent): string {
  // Shows and same-day rehearsals wear their school's palette color; everything
  // else (arrival, Directors' Meeting, admin/critique/awards) is grey — distinct
  // from school 1. Mirrors the generated .xlsx.
  if (ev.type === 'show' || ev.type === 'rehearsal') {
    return SCHOOL_COLORS_HEX[ev.colorIdx % SCHOOL_COLORS_HEX.length];
  }
  return GREY;
}

export function SchedulePreview({ contest }: { contest: Contest }) {
  // The whole day: for a same-day rehearsal contest this includes the CM-arrival
  // and rehearsal rows ahead of the contest timeline (PRD #179).
  const events = computeContestDay(contest);
  // Advisory only — flags mark rows in the preview and list plain-language
  // reasons below. They never block generation and are never in the document.
  const flags = validateSchedule(events);
  const flagged = new Set(flags.map((f) => f.index));

  return (
    <Section title="🗓️ Contest Day Schedule Preview" badge="Live">
      {events.length === 0 ? (
        <p className="muted schedule-empty">Enter a First Show / Setup Time to see schedule preview.</p>
      ) : (
        <>
          <table className="schedule-preview">
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>What</th>
                <th>School</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={i} className={flagged.has(i) ? 'is-flagged' : undefined} style={{ background: rowColor(ev) }}>
                  <td>{fmtTime(ev.start)}</td>
                  <td>{fmtTime(ev.end)}</td>
                  <td>
                    {ev.label}
                    {flagged.has(i) ? ' ⚠️' : ''}
                  </td>
                  <td>
                    {ev.type === 'show' || ev.type === 'rehearsal'
                      ? ev.school + (ev.play ? ` — ${ev.play}` : '')
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {flags.length > 0 && (
            <ul className="schedule-flags">
              {flags.map((f, i) => (
                <li key={i}>⚠️ {f.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
