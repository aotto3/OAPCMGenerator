import { useSyncExternalStore } from 'react';

/**
 * The Undo toast's tiny store (PRD #304, #312). An automatic checkpoint taken
 * before a destructive action (#309) announces itself here; the Workspace
 * renders the toast and restores the checkpoint when the CM clicks Undo. One
 * toast at a time: a newer action replaces the older offer. Its checkpoint is
 * still in Manual Save after the toast goes away.
 */
export interface UndoOffer {
  /** What just happened, e.g. "Draw re-run". */
  message: string;
  contestId: string;
  checkpointId: string;
  /** Distinguishes two offers with the same text (restarts the fade timer). */
  nonce: number;
}

let current: UndoOffer | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function offerUndo(offer: Omit<UndoOffer, 'nonce'>): void {
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
