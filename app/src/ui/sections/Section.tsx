import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SectionCompletion } from '../../model/contest';

/**
 * A broadcast signal that opens or collapses every section at once (Slice 18).
 * Sections read it from context rather than through props, so the Workspace can
 * drive them all without threading a prop through every section wrapper. The
 * `nonce` makes each expand/collapse click a distinct event: a section applies
 * the signal only when the nonce changes, so its own manual toggles and the
 * mount-time `defaultOpen` are preserved until the next global action.
 */
export interface SectionOpenSignal {
  open: boolean;
  nonce: number;
}
export const SectionOpenContext = createContext<SectionOpenSignal | null>(null);

/**
 * Collapsible workspace section (v12 section-header/section-body), plus the
 * 2.0 completion chip — "3/6", green once every expected field is filled.
 */
export function Section({
  title,
  badge,
  completion,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Phase hint shown on the right, e.g. "After Planning Meeting". */
  badge?: string;
  completion?: SectionCompletion;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Apply a global expand/collapse only when its nonce changes — never at mount
  // (so defaultOpen wins) and never on unrelated re-renders (so a hand toggle
  // sticks until the next global action).
  const signal = useContext(SectionOpenContext);
  const lastNonce = useRef(signal?.nonce);
  useEffect(() => {
    if (signal && signal.nonce !== lastNonce.current) {
      lastNonce.current = signal.nonce;
      setOpen(signal.open);
    }
  }, [signal]);

  const done = completion !== undefined && completion.total > 0 && completion.done >= completion.total;

  return (
    <section className="section">
      <button
        type="button"
        className="section-header"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <h2>{title}</h2>
        <span className="section-meta">
          {completion && (
            <span className={done ? 'chip chip-done' : 'chip'} title="Fields completed">
              {completion.done}/{completion.total}
            </span>
          )}
          {badge && <span className="badge">{badge}</span>}
          <span className={open ? 'chevron chevron-open' : 'chevron'} aria-hidden>▼</span>
        </span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
