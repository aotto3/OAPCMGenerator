import {
  lockCritique,
  moveCritiqueAssignment,
  setCritiqueAssignment,
  unlockCritique,
  type Contest,
} from '../../model/contest';
import { critiqueDistribution, generateCritiqueAssignments } from '../../model/critique';
import { critiqueRows } from '../../documents/docVars';
import { Section } from './Section';

/**
 * Critique Assignment Randomizer (v12 sec-critique). Generates a random
 * judge-per-school assignment, lets the CM fine-tune it with adjacent ↑↓ swaps,
 * and locks it. Everything is stored in the contest record via the model
 * helpers, so autosave persists it — this component holds no state of its own
 * and never touches storage.
 *
 * The RANDOMIZATION is the pure model/critique.ts algorithm (Math.random by
 * default); the STORED result is what persists, matching v12's frozen locked
 * assignment. Locking flows the result into the Directors Meeting Agenda.
 */

/** v12 judgeColors — pale row tints so each judge reads at a glance. */
const JUDGE_COLORS = ['#D6E4F0', '#D8EDDA', '#FFF3CD', '#FCE4EC'];

export function CritiqueSection({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  const rows = critiqueRows(contest);
  const locked = contest.critique?.locked ?? false;
  const afterEach = contest.details.critiqueFormat === 'after_each';
  const numJudges = contest.details.numJudges;

  function handleGenerate() {
    if (locked) {
      if (!window.confirm('This assignment is locked. Unlock and re-randomize?')) return;
    } else if (contest.critique) {
      if (!window.confirm('Are you sure you want to regenerate critique assignments?')) return;
    }
    onChange(setCritiqueAssignment(contest, generateCritiqueAssignments(contest)));
  }

  function handleUnlock() {
    if (!window.confirm('Unlock this assignment? It will no longer be frozen for the Directors Meeting Agenda.')) return;
    onChange(unlockCritique(contest));
  }

  const distribution = rows ? critiqueDistribution(contest.critique!.judgeByPosition, numJudges) : [];

  return (
    <Section title="🎲 Critique Assignment Randomizer" badge="CM Eyes Only">
      <div className="note-box">
        Randomly assigns critiques to judges based on the number of schools and judges. Judge 1 receives{' '}
        <em>fewer</em> assignments when not evenly divisible. In “After Each Show” mode, Judge 1 is never assigned the
        last school. Lock the assignment to freeze it into the Directors Meeting Agenda.
      </div>

      <div className="critique-generate-row">
        <button type="button" className="btn-primary critique-generate-btn" onClick={handleGenerate}>
          🎲 {contest.critique ? 'Regenerate' : 'Generate'} Critique Assignments
        </button>
      </div>

      {rows && (
        <>
          <table className="critique-table">
            <thead>
              <tr>
                <th className="critique-col-num">#</th>
                <th>School</th>
                <th>Play Title</th>
                <th>Judge Assigned</th>
                {!locked && <th className="critique-col-move">Move</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ background: JUDGE_COLORS[(r.judgeNumber - 1) % JUDGE_COLORS.length] }}>
                  <td className="critique-col-num">{i + 1}</td>
                  <td>{r.school}</td>
                  <td className="critique-play">{r.play || '—'}</td>
                  <td className="critique-judge">
                    Judge {r.judgeNumber}
                    {r.judgeName ? ` — ${r.judgeName}` : ''}
                  </td>
                  {!locked && (
                    <td className="critique-col-move">
                      <button
                        type="button"
                        className="critique-move-btn"
                        title="Move up"
                        disabled={i === 0}
                        onClick={() => onChange(moveCritiqueAssignment(contest, i, -1))}
                      >
                        ↑
                      </button>{' '}
                      <button
                        type="button"
                        className="critique-move-btn"
                        title="Move down"
                        disabled={i === rows.length - 1}
                        onClick={() => onChange(moveCritiqueAssignment(contest, i, 1))}
                      >
                        ↓
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="critique-summary">
            {distribution.map((count, idx) => (
              <span
                key={idx}
                className="critique-summary-chip"
                style={{ background: JUDGE_COLORS[idx % JUDGE_COLORS.length] }}
              >
                Judge {idx + 1}
                {contest.adjudicators[idx]?.name ? ` (${contest.adjudicators[idx].name})` : ''}:{' '}
                <strong>
                  {count} critique{count !== 1 ? 's' : ''}
                </strong>
              </span>
            ))}
          </div>

          {afterEach && (
            <p className="critique-hint">⚠️ After-Each mode: Judge 1 is not assigned the last school.</p>
          )}

          {locked ? (
            <div className="critique-lock-row">
              <span className="critique-locked-notice">🔒 Assignment locked — saved with this contest</span>
              <button type="button" className="critique-unlock-btn" onClick={handleUnlock}>
                🔓 Unlock &amp; Re-randomize
              </button>
            </div>
          ) : (
            <div className="critique-lock-row critique-lock-row-center">
              <button type="button" className="btn-primary critique-lock-btn" onClick={() => onChange(lockCritique(contest))}>
                🔒 Lock &amp; Save This Assignment
              </button>
              <p className="critique-hint">Use ↑↓ to adjust order first, then lock to freeze it into documents.</p>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
