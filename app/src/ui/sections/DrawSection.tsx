import {
  lockDraw,
  numSchools,
  runDraw,
  schoolsInPerformanceOrder,
  unlockDraw,
  type Contest,
} from '../../model/contest';
import { drawOrder } from '../../model/draw';
import { Section } from './Section';

/**
 * Performance Order Draw (PRD #65, Group B). Runs the official blind draw for
 * performance order: one click randomizes every slot via the pure model/draw.ts
 * generator, writing the result into the schools' existing performanceOrder
 * fields through the B1 updaters — so the schedule, letters, and critique
 * assignments pick it up with no extra wiring.
 *
 * Lifecycle mirrors the critique randomizer: re-draw freely while unlocked, then
 * LOCK to freeze (which disables the manual Performance Order inputs in the Plays
 * section). UNLOCK requires a confirmation and VOIDS the audit record, so a
 * hand-picked accommodation is never presented as the product of a blind draw.
 * The component holds no state of its own — everything lives in the contest
 * record via the model helpers, so autosave/sync/export carry it.
 */
export function DrawSection({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  const draw = contest.draw;
  const locked = draw?.locked ?? false;
  const ordered = schoolsInPerformanceOrder(contest);

  function handleDraw() {
    if (draw && !locked) {
      if (!window.confirm('Re-run the draw? This replaces the current drawn order and timestamp.')) return;
    }
    onChange(runDraw(contest, drawOrder(numSchools(contest))));
  }

  function handleUnlock() {
    if (
      !window.confirm(
        'Unlock this draw? The audit record is voided and the manual Performance Order inputs are re-enabled. ' +
          'A hand-edited order is no longer certified as a blind draw.',
      )
    ) {
      return;
    }
    onChange(unlockDraw(contest));
  }

  return (
    <Section title="🎟️ Performance Order Draw" badge="After Entry Deadline" defaultOpen={false}>
      <p className="note-box">
        Run the official blind draw for performance order. One click randomizes every slot; re-draw as
        many times as you like until you <strong>lock</strong> it. Locking freezes the order and
        disables the manual Performance Order inputs in the Plays section. Unlocking voids the record so
        an accommodation (a hand-picked slot) is never presented as a blind draw. The drawn order flows
        straight into the schedule, letters, and critique assignments.
      </p>

      {!locked && (
        <div className="critique-generate-row">
          <button type="button" className="btn-primary critique-generate-btn" onClick={handleDraw}>
            🎟️ {draw ? 'Re-draw Performance Order' : 'Draw Performance Order'}
          </button>
        </div>
      )}

      {draw ? (
        <>
          <table className="draw-table">
            <thead>
              <tr>
                <th className="draw-col-slot">Slot</th>
                <th>School</th>
                <th>Play Title</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((s, i) => (
                <tr key={i}>
                  <td className="draw-col-slot">{s.performanceOrder}</td>
                  <td>{s.name.trim() || <span className="muted">Unnamed school</span>}</td>
                  <td className="draw-play">{s.playTitle.trim() || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="draw-audit">🕒 Drawn {new Date(draw.drawnAt).toLocaleString()}</p>

          {locked ? (
            <div className="critique-lock-row">
              <span className="critique-locked-notice">🔒 Draw locked — performance order frozen</span>
              <button type="button" className="critique-unlock-btn" onClick={handleUnlock}>
                🔓 Unlock Draw
              </button>
            </div>
          ) : (
            <div className="critique-lock-row critique-lock-row-center">
              <button
                type="button"
                className="btn-primary critique-lock-btn"
                onClick={() => onChange(lockDraw(contest))}
              >
                🔒 Lock This Draw
              </button>
              <p className="critique-hint">
                Locking freezes the order and disables the manual Performance Order inputs in the Plays
                section.
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="critique-hint draw-empty">
          No draw yet — the current performance order is whatever's entered in the Plays section.
        </p>
      )}
    </Section>
  );
}
