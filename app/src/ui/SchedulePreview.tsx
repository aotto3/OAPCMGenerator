import { useRef, useState } from 'react';
import {
  computeContestDay,
  fmtTime,
  parseTime,
  scheduleEventKey,
  setRowStart,
  type ScheduleEvent,
} from '../model/schedule';
import { validateSchedule } from '../model/scheduleValidation';
import { addBreak, removeBreak, setArrival, updateBreak, withDetails, type Contest } from '../model/contest';
import { Section } from './sections/Section';

/**
 * Live contest-day schedule preview (v12 updateSchedulePreview). The pure engine
 * does the math; this component owns the presentation — the school color palette
 * and the empty state — which the engine deliberately does not.
 *
 * With an `onChange` it is also a light editor (PRD #179 / #192): every row's
 * start time is click-to-edit (anchor rows route to their field; downstream rows
 * store a blank nudge that just moves them), and "+ break" inserts a deliberate,
 * labeled break row that can be renamed / resized / moved / removed. Without
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
  // The whole day: for a same-day rehearsal contest this includes the CM-arrival
  // and rehearsal rows ahead of the contest timeline (PRD #179).
  const events = computeContestDay(contest);
  // Advisory only — flags mark rows in the preview and list plain-language
  // reasons below. They never block generation and are never in the document.
  const flags = validateSchedule(events);
  const flagged = new Set(flags.map((f) => f.index));
  const editable = !!onChange;

  // Click-to-edit start times: which row's time input is currently open, and a
  // flag so Escape closes it without committing the typed value.
  const [editing, setEditing] = useState<number | null>(null);
  const cancelRef = useRef(false);

  // The anchorable rows in day order — moving a break re-anchors it to the
  // previous/next of these (breaks and arrival/rehearsal rows are not anchors).
  const anchorKeys = events.map(scheduleEventKey).filter((k): k is string => k != null);
  const moveTarget = (current: string, dir: -1 | 1): string | null => {
    const j = anchorKeys.indexOf(current) + dir;
    return j >= 0 && j < anchorKeys.length ? anchorKeys[j] : null;
  };

  // How a row's start edit is applied. Anchor rows write their own field (the
  // whole day/block moves); downstream rows store a nudge before them. Rows with
  // no editor (breaks, and — for now — arrival/rehearsals) return null.
  const startCommit = (ev: ScheduleEvent, i: number): ((mins: number) => Contest) | null => {
    if (!onChange) return null;
    switch (ev.type) {
      case 'show':
        return ev.colorIdx === 0
          ? (mins) => withDetails(contest, { firstShowTime: fmtTime(mins) })
          : (mins) => setRowStart(contest, events, i, mins);
      case 'rehearsal':
        // First rehearsal is the anchor (its start-time field); the rest nudge.
        return ev.colorIdx === 0
          ? (mins) => withDetails(contest, { rehearsalStartTime1: fmtTime(mins) })
          : (mins) => setRowStart(contest, events, i, mins);
      case 'dm':
        return (mins) => withDetails(contest, { directorsMeetingTime: fmtTime(mins) });
      case 'arrival':
        return (mins) => setArrival(contest, mins);
      case 'trans':
      case 'admin':
      case 'crit':
      case 'awards':
        return (mins) => setRowStart(contest, events, i, mins);
      default:
        return null; // break rows are edited via their own controls
    }
  };

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
                {editable && <th aria-label="Edit" />}
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => {
                const anchor = scheduleEventKey(ev);
                const gap =
                  ev.type === 'break' && ev.overrideId
                    ? contest.scheduleOverrides.gaps.find((g) => g.id === ev.overrideId)
                    : undefined;
                const isBreak = editable && !!gap;
                const commitStart = startCommit(ev, i);
                return (
                  <tr key={i} className={flagged.has(i) ? 'is-flagged' : undefined} style={{ background: rowColor(ev) }}>
                    <td>
                      {commitStart && editing === i ? (
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
                            if (mins != null && mins !== ev.start) onChange!(commitStart(mins));
                          }}
                        />
                      ) : commitStart ? (
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
                          onChange={(e) => onChange!(updateBreak(contest, gap!.id, { label: e.target.value }))}
                        />
                      ) : (
                        <>
                          {ev.label}
                          {flagged.has(i) ? ' ⚠️' : ''}
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
                            onChange={(e) => {
                              const m = parseInt(e.target.value, 10);
                              if (m >= 1) onChange!(updateBreak(contest, gap!.id, { minutes: m }));
                            }}
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
                              disabled={!moveTarget(gap!.anchor, -1)}
                              onClick={() => onChange!(updateBreak(contest, gap!.id, { anchor: moveTarget(gap!.anchor, -1)! }))}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn-util"
                              title="Move break later"
                              disabled={!moveTarget(gap!.anchor, 1)}
                              onClick={() => onChange!(updateBreak(contest, gap!.id, { anchor: moveTarget(gap!.anchor, 1)! }))}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn-util"
                              title="Remove this break"
                              onClick={() => onChange!(removeBreak(contest, gap!.id))}
                            >
                              ✕
                            </button>
                          </>
                        ) : anchor ? (
                          <button
                            type="button"
                            className="btn-util"
                            title="Insert a break after this row"
                            onClick={() => onChange!(addBreak(contest, anchor, DEFAULT_BREAK_MINUTES, 'Break'))}
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
