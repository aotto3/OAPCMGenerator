import { useEffect, useState } from 'react';
import { dismissUndo, useUndoOffer } from './undoOffer';

/** How long the toast stays up before fading (the checkpoint stays in Manual Save). */
const TOAST_MS = 8000;

/**
 * The one-click Undo after a destructive action (PRD #304, #312). Shows the
 * latest offer for THIS contest. A checkpoint offer restores its automatic
 * checkpoint through the open contest's restore, which checkpoints the current
 * state first, so the undo can itself be undone from Manual Save. An offer with
 * its own undo action (a deleted email template, PRD #320) runs that instead.
 * Never blocks input.
 */
export function UndoToast({
  contestId,
  onUndo,
}: {
  contestId: string;
  /** Restore the checkpoint into the open contest. */
  onUndo: (checkpointId: string) => Promise<void>;
}) {
  const offer = useUndoOffer();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const shown = offer && offer.contestId === contestId ? offer : null;

  useEffect(() => {
    setFailed(false);
    if (!shown) return;
    const timer = setTimeout(() => dismissUndo(shown.nonce), TOAST_MS);
    return () => clearTimeout(timer);
  }, [shown?.nonce]);

  // Leaving the contest drops its offer, so it never pops up elsewhere later.
  useEffect(() => () => dismissUndo(), []);

  if (!shown) return null;

  async function undo() {
    if (!shown || busy) return;
    setBusy(true);
    try {
      if ('undo' in shown) await shown.undo();
      else await onUndo(shown.checkpointId);
      dismissUndo(shown.nonce);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span>{failed
          ? 'undo' in shown
            ? shown.failMessage
            : "Couldn't undo. Restore it from Manual Save."
          : `${shown.message}.`}</span>
      {!failed && (
        <button type="button" className="undo-toast-btn" disabled={busy} onClick={() => void undo()}>
          Undo
        </button>
      )}
      <button type="button" className="undo-toast-close" aria-label="Dismiss" onClick={() => dismissUndo(shown.nonce)}>
        ✕
      </button>
    </div>
  );
}
