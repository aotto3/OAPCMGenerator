import { computeSchedule, fmtTime, type ScheduleEvent } from '../model/schedule';
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
  if (ev.type === 'show') return SCHOOL_COLORS_HEX[ev.colorIdx % SCHOOL_COLORS_HEX.length];
  if (ev.type === 'dm') return SCHOOL_COLORS_HEX[0];
  return GREY;
}

export function SchedulePreview({ contest }: { contest: Contest }) {
  const events = computeSchedule(contest);

  return (
    <Section title="🗓️ Contest Day Schedule Preview" badge="Live">
      {events.length === 0 ? (
        <p className="muted schedule-empty">Enter a First Show / Setup Time to see schedule preview.</p>
      ) : (
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
              <tr key={i} style={{ background: rowColor(ev) }}>
                <td>{fmtTime(ev.start)}</td>
                <td>{fmtTime(ev.end)}</td>
                <td>{ev.label}</td>
                <td>{ev.type === 'show' ? ev.school + (ev.play ? ` — ${ev.play}` : '') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
