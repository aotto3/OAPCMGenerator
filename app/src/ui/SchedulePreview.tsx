import { useRef, useState } from 'react';
import { fmtTime, parseTime, type ScheduleEvent } from '../model/schedule';
import { applyScheduleEdit, scheduleRows, type ScheduleEdit } from '../model/scheduleEdit';
import type { Contest } from '../model/contest';
import { Section } from './sections/Section';

/**
 * Live contest-day schedule preview (v12 updateSchedulePreview). The pure engine
 * does the math; this component owns the presentation (the school color palette
 * and the empty state), which the engine deliberately does not.
 *
 * With an `onChange` it is also a light editor (PRD #179 / #192): every row's
 * start time is click-to-edit, and "+ break" inserts a labeled break row that can
 * be renamed / resized / moved / removed. What each edit MEANS (which field a
 * row's time writes, nudges, break re-anchoring) belongs to scheduleEdit.ts
 * (RFC #264); this component only renders its rows and dispatches edits. Without
 * `onChange` (the read-only Setup mirror) it just renders.
 */

/** A new break's default length; the CM edits it inline. */
const DEFAULT_BREAK_MINUTES = 15;

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

export function SchedulePreview({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange?: (next: Contest) => void;
}) {
  // The whole day (for a same-day rehearsal contest this includes the CM-arrival
  // and rehearsal rows, PRD #179) with validation flags and per-row edit
  // capabilities. Flags are advisory only: they mark rows and list plain-language
  // reasons below, never block generation, and are never in the document.
  const rows = scheduleRows(contest);
  const allFlags = rows.flatMap((r) => r.flags);
  const editable = !!onChange;

  /** Dispatches one edit; an edit that changes nothing is not saved. */
  const apply = (edit: ScheduleEdit) => {
    if (!onChange) return;
    const next = applyScheduleEdit(contest, edit);
    if (next !== contest) onChange(next);
  };

  // Click-to-edit start times: which row's time input is currently open, and a
  // flag so Escape closes it without committing the typed value.
  const [editing, setEditing] = useState<number | null>(null);
  const cancelRef = useRef(false);

  return (
    <Section title="🗓️ Contest Day Schedule Preview" badge="Live">
      {rows.length === 0 ? (
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
                {editable && <th aria-label="Edit" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const ev = row.event;
                const flagged = row.flags.length > 0;
                const canEditStart = editable && row.canEditStart;
                const isBreak = editable && row.isBreak;
                return (
                  <tr key={i} className={flagged ? 'is-flagged' : undefined} style={{ background: rowColor(ev) }}>
                    <td>
                      {canEditStart && editing === i ? (
                        <input
                          className="schedule-start-input"
                          autoFocus
                          defaultValue={fmtTime(ev.start)}
                          aria-label="Edit start time"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            else if (e.key === 'Escape') {
                              cancelRef.current = true;
                              e.currentTarget.blur();
                            }
                          }}
                          onBlur={(e) => {
                            const cancelled = cancelRef.current;
                            cancelRef.current = false;
                            setEditing(null);
                            if (cancelled) return;
                            const mins = parseTime(e.target.value);
                            if (mins != null) apply({ kind: 'setStart', row: i, minutes: mins });
                          }}
                        />
                      ) : canEditStart ? (
                        <button
                          type="button"
                          className="schedule-time-btn"
                          title="Click to edit the start time"
                          onClick={() => setEditing(i)}
                        >
                          {fmtTime(ev.start)}
                        </button>
                      ) : (
                        fmtTime(ev.start)
                      )}
                    </td>
                    <td>{fmtTime(ev.end)}</td>
                    <td>
                      {isBreak ? (
                        <input
                          className="schedule-break-label"
                          value={ev.label}
                          aria-label="Break label"
                          onChange={(e) => apply({ kind: 'renameBreak', row: i, label: e.target.value })}
                        />
                      ) : (
                        <>
                          {ev.label}
                          {flagged ? ' ⚠️' : ''}
                        </>
                      )}
                    </td>
                    <td>
                      {isBreak ? (
                        <span className="schedule-break-min">
                          <input
                            type="number"
                            min={1}
                            value={ev.dur}
                            aria-label="Break minutes"
                            onChange={(e) =>
                              apply({ kind: 'resizeBreak', row: i, minutes: parseInt(e.target.value, 10) })
                            }
                          />{' '}
                          min
                        </span>
                      ) : ev.type === 'show' || ev.type === 'rehearsal' ? (
                        ev.school + (ev.play ? ` — ${ev.play}` : '')
                      ) : (
                        ''
                      )}
                    </td>
                    {editable && (
                      <td className="schedule-actions">
                        {isBreak ? (
                          <>
                            <button
                              type="button"
                              className="btn-util"
                              title="Move break earlier"
                              disabled={!row.canMoveUp}
                              onClick={() => apply({ kind: 'moveBreak', row: i, direction: -1 })}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn-util"
                              title="Move break later"
                              disabled={!row.canMoveDown}
                              onClick={() => apply({ kind: 'moveBreak', row: i, direction: 1 })}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn-util"
                              title="Remove this break"
                              onClick={() => apply({ kind: 'removeBreak', row: i })}
                            >
                              ✕
                            </button>
                          </>
                        ) : row.canAddBreakAfter ? (
                          <button
                            type="button"
                            className="btn-util"
                            title="Insert a break after this row"
                            onClick={() =>
                              apply({ kind: 'addBreak', afterRow: i, minutes: DEFAULT_BREAK_MINUTES, label: 'Break' })
                            }
                          >
                            + break
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {allFlags.length > 0 && (
            <ul className="schedule-flags">
              {allFlags.map((message, i) => (
                <li key={i}>⚠️ {message}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
