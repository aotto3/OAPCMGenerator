import { useRef, useState, type KeyboardEvent } from 'react';
import { setTabulationConfirmed, setTabulationNotRanked, setTabulationRank, type Contest } from '../../model/contest';
import {
  cellIssueMessage,
  fillResultsFromTabulation,
  fillWouldOverwrite,
  tabulationFill,
  tabulationView,
} from '../../model/tabulation';
import { tabulationReport } from '../../model/tabulationReport';
import { tabulationEmail } from '../../documents/emailTemplates';
import { mailAppName, openDraft, usePreferredMailApp } from '../mailApp';
import { triggerPanelTabulationDownload } from '../../documents/generate';
import { openTabulationPrintPage } from '../tabulationPrint';
import { autoCheckpoint } from '../autoCheckpoint';
import { Section } from './Section';

/**
 * Panel Tabulation (PRD #236). The CM types the three judges' ranks into a grid
 * shaped like UIL's TTAO Tabulation Tool (schools down in performance order,
 * Acting Judge / Judge B / Judge C across). Everything shown is the pure
 * tabulationView(): live labels, per-cell validation, missing-rank notes, and,
 * once every ballot is valid, the places from the rank.js port.
 *
 * Tab (and Enter) move DOWN a judge's column, so a ballot read aloud is entered
 * one judge at a time; at the bottom of a column focus jumps to the top of the
 * next. Shift reverses. Not-ranked rows are skipped.
 */

const COLUMN_TITLES = ['Acting Judge', 'Judge B', 'Judge C'] as const;

export function TabulationSection({ contest, onChange }: { contest: Contest; onChange: (c: Contest) => void }) {
  const view = tabulationView(contest);
  const cells = useRef(new Map<string, HTMLInputElement>());
  const [popupBlocked, setPopupBlocked] = useState<'print' | 'mail' | null>(null);
  // The CM's chosen email app (#308), set in the Email pane.
  const [mailApp] = usePreferredMailApp();
  const appName = mailAppName(mailApp);
  const [mailNote, setMailNote] = useState<string | null>(null);
  const [filledNote, setFilledNote] = useState<string | null>(null);

  if (!view.applicable) {
    return (
      <Section title="🧮 Panel Tabulation" badge="Contest Day" defaultOpen={false}>
        <p className="hint">Tabulation is for a 3-judge panel. Set the number of judges to 3 in Details to use it.</p>
      </Section>
    );
  }

  // Column-major order of the cells that can take focus (ranked rows only).
  const focusOrder: string[] = [];
  for (let j = 0; j < 3; j++) {
    for (const row of view.rows) if (!row.notRanked) focusOrder.push(`${row.schoolIndex}-${j}`);
  }

  function onCellKey(e: KeyboardEvent<HTMLInputElement>, key: string) {
    if (e.key !== 'Tab' && e.key !== 'Enter') return;
    const at = focusOrder.indexOf(key);
    const next = focusOrder[at + (e.shiftKey ? -1 : 1)];
    if (next === undefined) return; // leave the grid normally
    e.preventDefault();
    const el = cells.current.get(next);
    el?.focus();
    el?.select();
  }

  const missingNotes = view.missingRanks
    .map((missing, j) =>
      missing.length > 0
        ? `${COLUMN_TITLES[j]} (${view.judgeNames[j]}) has no rank ${missing.join(', ')}.`
        : null,
    )
    .filter((n): n is string => n !== null);

  return (
    <Section title="🧮 Panel Tabulation" badge="Contest Day" defaultOpen={false}>
      <p className="hint">
        Enter each judge's ranks from the ballots. Tab and Enter move down a judge's column. Schools are in performance
        order; mark a school Not ranked if it withdrew or was disqualified.
      </p>

      <div className="tab-grid-scroll">
        <table className="tab-grid">
          <thead>
            <tr>
              <th className="tab-col-school">School - Play</th>
              {COLUMN_TITLES.map((title, j) => (
                <th key={title} className="tab-col-rank">
                  {title}
                  <span className="tab-judge-name">{view.judgeNames[j]}</span>
                </th>
              ))}
              <th className="tab-col-notranked">Not ranked</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.schoolIndex} className={row.notRanked ? 'tab-row-out' : undefined}>
                <td className="tab-col-school">{row.label}</td>
                {row.ranks.map((text, j) => {
                  const issue = row.issues[j];
                  const showError = issue !== null && issue !== 'blank';
                  const key = `${row.schoolIndex}-${j}`;
                  return (
                    <td key={j} className="tab-col-rank">
                      <input
                        ref={(el) => {
                          if (el) cells.current.set(key, el);
                          else cells.current.delete(key);
                        }}
                        className={`tab-rank-input${showError ? ' tab-rank-error' : ''}`}
                        type="text"
                        inputMode="numeric"
                        maxLength={3}
                        disabled={row.notRanked}
                        value={row.notRanked ? '' : text}
                        aria-label={`${COLUMN_TITLES[j]} rank for ${row.label}`}
                        aria-invalid={showError || undefined}
                        onKeyDown={(e) => onCellKey(e, key)}
                        onChange={(e) => {
                          setFilledNote(null);
                          onChange(setTabulationRank(contest, row.schoolIndex, j, e.target.value));
                        }}
                      />
                      {showError && <span className="tab-cell-error">{cellIssueMessage(issue, view.rankedCount)}</span>}
                    </td>
                  );
                })}
                <td className="tab-col-notranked">
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    checked={row.notRanked}
                    aria-label={`${row.label} not ranked`}
                    onChange={(e) => {
                      setFilledNote(null);
                      onChange(setTabulationNotRanked(contest, row.schoolIndex, e.target.checked));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tab-status" role="status">
        {view.errorCount > 0 && (
          <p className="tab-status-error">
            {view.errorCount} {view.errorCount === 1 ? 'entry needs' : 'entries need'} fixing before the tabulation can
            be calculated.
          </p>
        )}
        {missingNotes.map((note) => (
          <p key={note} className="tab-status-error">
            {note}
          </p>
        ))}
        {view.errorCount === 0 && view.blankCount > 0 && (
          <p className="hint">
            {view.blankCount} {view.blankCount === 1 ? 'rank' : 'ranks'} still to enter. Results appear when every
            ballot is complete.
          </p>
        )}
      </div>

      {view.results && (
        <>
          <h3 className="tab-results-title">Results</h3>
          <div className="tab-grid-scroll">
            <table className="draw-table tab-results">
              <thead>
                <tr>
                  <th />
                  <th>Place</th>
                  {view.judgeNames.map((name, j) => (
                    <th key={j}>{name}</th>
                  ))}
                  <th>Diagnostic</th>
                </tr>
              </thead>
              <tbody>
                {view.results.map((r) => (
                  <tr key={r.schoolIndex}>
                    <td>
                      {r.label}
                      {r.tie && <span className="tab-tie"> - TIE</span>}
                    </td>
                    <td className="tab-place">{r.place}</td>
                    {r.ranks.map((rank, j) => (
                      <td key={j}>{rank}</td>
                    ))}
                    <td title={r.diagnosticCode}>{r.diagnostic}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <label className="tab-confirm">
        <input
          type="checkbox"
          checked={contest.tabulation.judgesConfirmed}
          onChange={(e) => onChange(setTabulationConfirmed(contest, e.target.checked))}
        />
        Judges confirmed ranks
        <span className="hint">The adjudicators checked the ranks above. Changing any rank clears this.</span>
      </label>

      <div className="tab-actions">
        <button
          type="button"
          className="btn-util"
          disabled={!view.results}
          title={view.results ? undefined : "Enter every judge's ranks first"}
          onClick={() => {
            const fill = tabulationFill(contest);
            if (!fill) return;
            if (
              fillWouldOverwrite(contest) &&
              !window.confirm(
                'Results already has different advancing schools or an alternate.\n\nReplace them with the tabulation? Individual awards are not changed.',
              )
            ) {
              return;
            }
            if (fillWouldOverwrite(contest)) autoCheckpoint(contest, 'Before replacing results from tabulation', 'Results replaced from tabulation');
            onChange(fillResultsFromTabulation(contest));
            const name = (i: number) => view.rows.find((r) => r.schoolIndex === i)?.label ?? `School ${i + 1}`;
            setFilledNote(
              `Results filled: ${fill.advancing.map(name).join(', ')} advancing` +
                (fill.alternate === null ? ', no alternate.' : `; alternate ${name(fill.alternate)}.`),
            );
          }}
        >
          ➡ Fill Results from tabulation
        </button>
        <button
          type="button"
          className="btn-util"
          disabled={!view.results}
          title={view.results ? undefined : "Enter every judge's ranks first"}
          onClick={() => {
            const report = tabulationReport(contest);
            if (report) setPopupBlocked(openTabulationPrintPage(report) ? null : 'print');
          }}
        >
          🖨 Print UIL Tabulation
        </button>
        <button
          type="button"
          className="btn-util"
          disabled={!view.results}
          title={view.results ? undefined : "Enter every judge's ranks first"}
          onClick={() => {
            const draft = tabulationEmail(contest, 'downloads');
            if (!draft) return;
            // Open the email first, inside the click, so the browser treats it as user-initiated.
            const opened = openDraft(mailApp, draft);
            setPopupBlocked(opened.blocked ? 'mail' : null);
            setMailNote(null);
            const pasteNote = opened.bodyCopied
              ? ' The message was too long for a mail link, so the body was copied: paste it in.'
              : '';
            triggerPanelTabulationDownload(contest).then(
              () => setMailNote(`Panel Tabulation.pdf was saved to your Downloads. Attach it in ${appName} before sending.${pasteNote}`),
              () => setMailNote('Could not create Panel Tabulation.pdf. Generate it from the documents ZIP instead.'),
            );
          }}
        >
          ✉ Email to UIL State Director
        </button>
        <span className="hint">
          {view.results
            ? `Print opens UIL's results page. Email opens ${appName} filled in and saves Panel Tabulation.pdf for you to attach.`
            : 'Available once every ballot is entered.'}
        </span>
      </div>
      {filledNote && <p className="hint">{filledNote}</p>}
      {mailNote && <p className="hint">{mailNote}</p>}
      {popupBlocked && (
        <p className="tab-status-error">
          The browser blocked the {popupBlocked === 'print' ? 'print' : appName} window. Allow pop-ups for this site and
          try again.
        </p>
      )}
    </Section>
  );
}
