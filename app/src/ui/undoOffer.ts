import { useSyncExternalStore } from 'react';

/**
 * The Undo toast's tiny store (PRD #304, #312). An automatic checkpoint taken
 * before a destructive action (#309) announces itself here; the Workspace
 * renders the toast and restores the checkpoint when the CM clicks Undo. One
 * toast at a time: a newer action replaces the older offer. Its checkpoint is
 * still in Manual Save after the toast goes away.
 *
 * An offer undoes in one of two ways: by restoring a contest checkpoint (the
 * contest's destructive actions), or by running its own undo action (a deleted
 * email template is re-created, PRD #320), which carries its own failure text.
 */
export type UndoAction =
  | { checkpointId: string }
  | {
      /** Reverses the action; rejects when it could not. */
      undo: () => Promise<void>;
      /** Shown when `undo` rejects. */
      failMessage: string;
    };

export type UndoOfferInput = {
  /** What just happened, e.g. "Draw re-run". */
  message: string;
  /** The contest whose workspace shows the toast. */
  contestId: string;
} & UndoAction;

export type UndoOffer = UndoOfferInput & {
  /** Distinguishes two offers with the same text (restarts the fade timer). */
  nonce: number;
};

let current: UndoOffer | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function offerUndo(offer: UndoOfferInput): void {
  current = { ...offer, nonce: ++nonce };
  emit();
}

/** Dismiss the offer (only if it is still the one shown). */
export function dismissUndo(offerNonce?: number): void {
  if (!current || (offerNonce !== undefined && current.nonce !== offerNonce)) return;
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUndoOffer(): UndoOffer | null {
  return useSyncExternalStore(subscribe, () => current);
}
