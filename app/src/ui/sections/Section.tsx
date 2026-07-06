import { useState, type ReactNode } from 'react';
import type { SectionCompletion } from '../../model/contest';

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
