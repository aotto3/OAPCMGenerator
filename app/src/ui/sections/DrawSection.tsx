import { useState } from 'react';
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
 * performance order two ways — an instant one-click shuffle and a projector-
 * friendly slot-by-slot live reveal — both via the pure model/draw.ts generator,
 * writing the result into the schools' existing performanceOrder fields through
 * the B1 updaters, so the schedule, letters, and critique assignments pick it up
 * with no extra wiring.
 *
 * Lifecycle mirrors the critique randomizer: re-draw freely while unlocked, then
 * LOCK to freeze (which disables the manual Performance Order inputs in the Plays
 * section). UNLOCK requires a confirmation and VOIDS the audit record, so a
 * hand-picked accommodation is never presented as the product of a blind draw.
 *
 * The live-reveal CEREMONY is ephemeral UI state only (PRD #65): the permutation
 * is generated once when the ceremony starts and held in local React state;
 * nothing is written to the contest until the final slot (or "reveal all") lands,
 * so abandoning or closing the app mid-ceremony discards it entirely. Everything
 * that DOES persist lives in the contest record via the model helpers, so
 * autosave/sync/export carry it.
 */

/** In-flight live reveal: a committed permutation plus how many slots are shown. */
interface Ceremony {
  /** drawOrder result — `order[i]` is the slot drawn for school i. Fixed at start. */
  order: number[];
  /** Number of slots revealed so far (0..N); N ⇒ the ceremony commits. */
  revealed: number;
}

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
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);

  const schoolLabel = (i: number) => contest.schools[i]?.name.trim() || `School ${i + 1}`;

  function handleInstantDraw() {
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

  // Live reveal. The permutation is fixed the moment the ceremony starts; reveals
  // only uncover it (no re-randomization mid-ceremony), and the contest is written
  // only when the last slot — or "reveal all" — lands.
  function startCeremony() {
    setCeremony({ order: drawOrder(numSchools(contest)), revealed: 0 });
  }

  function commitCeremony(order: number[]) {
    onChange(runDraw(contest, order));
    setCeremony(null);
  }

  function revealNextSlot() {
    if (!ceremony) return;
    const next = ceremony.revealed + 1;
    // The final reveal lands ⇒ commit the drawn order to the contest.
    if (next >= ceremony.order.length) commitCeremony(ceremony.order);
    else setCeremony({ ...ceremony, revealed: next });
  }

  function cancelCeremony() {
    // Ephemeral — dropping the state discards the draw with nothing persisted.
    setCeremony(null);
  }

  // Reveal rows in performance-slot order (slot 1 first): for each slot, the
  // school that drew it (the inverse of `order`, which is keyed by school index).
  const revealRows = ceremony
    ? ceremony.order.map((_, slotIdx) => ceremony.order.indexOf(slotIdx + 1))
    : [];

  return (
    <Section title="🎟️ Performance Order Draw" badge="After Entry Deadline" defaultOpen={false}>
      <p className="note-box">
        Run the official blind draw for performance order — an instant shuffle, or a slot-by-slot{' '}
        <strong>live reveal</strong> to project at the planning meeting. Re-draw as many times as you
        like until you <strong>lock</strong> it. Locking freezes the order and disables the manual
        Performance Order inputs in the Plays section. Unlocking voids the record so an accommodation (a
        hand-picked slot) is never presented as a blind draw. The drawn order flows straight into the
        schedule, letters, and critique assignments.
      </p>

      {ceremony ? (
        <div className="draw-ceremony">
          <p className="draw-ceremony-caption">
            🎭 Blind draw in progress — {ceremony.revealed} of {ceremony.order.length} slots revealed.
          </p>
          <ol className="draw-reveal-list">
            {revealRows.map((schoolIdx, slotIdx) => {
              const isRevealed = ceremony.revealed > slotIdx;
              const isNext = ceremony.revealed === slotIdx;
              return (
                <li
                  key={slotIdx}
                  className={`draw-reveal-row${isRevealed ? ' is-revealed' : isNext ? ' is-next' : ' is-hidden'}`}
                >
                  <span className="draw-reveal-slot">Slot {slotIdx + 1}</span>
                  <span className="draw-reveal-school">
                    {isRevealed ? schoolLabel(schoolIdx) : isNext ? '… and the next slot goes to …' : '•••'}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="draw-ceremony-actions">
            <button type="button" className="btn-primary" onClick={revealNextSlot}>
              🎭 Reveal Slot {ceremony.revealed + 1}
            </button>
            <button type="button" className="btn-util" onClick={() => commitCeremony(ceremony.order)}>
              Reveal all
            </button>
            <button type="button" className="btn-util draw-cancel" onClick={cancelCeremony}>
              Cancel
            </button>
          </div>
          <p className="critique-hint">
            Nothing is saved until the last slot is revealed — cancelling or closing now discards this draw.
          </p>
        </div>
      ) : (
        <>
          {!locked && (
            <div className="draw-actions">
              <button type="button" className="btn-primary" onClick={handleInstantDraw}>
                🎟️ {draw ? 'Re-draw (instant)' : 'Instant Draw'}
              </button>
              <button type="button" className="btn-util draw-live-btn" onClick={startCeremony}>
                🎭 Live Reveal Draw
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
                    Locking freezes the order and disables the manual Performance Order inputs in the
                    Plays section.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="critique-hint draw-empty">
              No draw yet — the current performance order is whatever's entered in the Plays section.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
