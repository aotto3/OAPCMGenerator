import { useEffect, useRef, useState } from 'react';
import type { SectionCompletion, SectionId } from '../model/contest';

/**
 * Sticky workspace navigation (Slice 16, issue #29): a phase-grouped progress
 * summary plus a compact jump-to menu so the long single-scroll workspace is
 * navigable and its completeness is glanceable (PRD module 6; user story 12).
 *
 * The jump control is a dropdown (not a scrolling chip strip) so every section
 * is reachable on one screen without horizontal scrolling. The trigger shows the
 * section currently in view (scroll-spy); opening it reveals the full list.
 *
 * Pure presentation over the model's per-section completion — it neither reads
 * nor writes the contest.
 */

interface NavSection {
  /** Matches the anchor id Workspace renders (e.g. "sec-cm"). */
  id: string;
  emoji: string;
  label: string;
  data?: { key: SectionId; phase: PhaseId };
}

type PhaseId = 'preliminary' | 'planning' | 'contracting' | 'entry';

const PHASES: { id: PhaseId; label: string }[] = [
  { id: 'preliminary', label: 'Preliminary Info' },
  { id: 'planning', label: 'Planning Mtg' },
  { id: 'contracting', label: 'Contracting' },
  { id: 'entry', label: 'Entry' },
];

const SECTIONS: NavSection[] = [
  { id: 'sec-cm', emoji: '👤', label: 'CM Info', data: { key: 'cm', phase: 'preliminary' } },
  { id: 'sec-identity', emoji: '📋', label: 'Identity', data: { key: 'identity', phase: 'preliminary' } },
  { id: 'sec-details', emoji: '📅', label: 'Details', data: { key: 'details', phase: 'planning' } },
  { id: 'sec-adjudicators', emoji: '⚖️', label: 'Judges', data: { key: 'adjudicators', phase: 'contracting' } },
  { id: 'sec-schools', emoji: '🏫', label: 'Schools', data: { key: 'schools', phase: 'entry' } },
  { id: 'sec-plays', emoji: '🎭', label: 'Plays', data: { key: 'plays', phase: 'entry' } },
  // No `data` ⇒ no completion dot: companies are optional, entered per-school (PRD #68).
  { id: 'sec-companies', emoji: '👥', label: 'Companies' },
  // No `data` ⇒ no completion dot: the draw is a tool, not a fill-in section (PRD #65).
  { id: 'sec-draw', emoji: '🎟️', label: 'Performance Order Draw' },
  // No `data` ⇒ no completion dot: compliance progress stays inside its section (PRD #64).
  { id: 'sec-compliance', emoji: '✅', label: 'Compliance' },
  { id: 'sec-schedule', emoji: '🗓️', label: 'Schedule' },
  { id: 'sec-critique', emoji: '🎲', label: 'Critique' },
  // No `data` ⇒ no completion dot: results are a post-contest tool, not a fill-in
  // section (PRD #66) — like the draw and compliance sections.
  { id: 'sec-results', emoji: '🏆', label: 'Results & Advancement' },
  { id: 'sec-generate', emoji: '⬇️', label: 'Generate Documents' },
  { id: 'sec-history', emoji: '💾', label: 'Manual Save' },
  { id: 'sec-email', emoji: '✉️', label: 'Email' },
];

/** Roll the six data sections up into their four phases. */
function phaseTotals(progress: Record<SectionId, SectionCompletion>) {
  return PHASES.map((phase) => {
    let done = 0;
    let total = 0;
    for (const s of SECTIONS) {
      if (s.data?.phase === phase.id) {
        done += progress[s.data.key].done;
        total += progress[s.data.key].total;
      }
    }
    const complete = total > 0 && done >= total;
    const state = complete ? 'done' : done > 0 ? 'partial' : 'empty';
    return { ...phase, done, total, state };
  });
}

/** Highlights the section currently in view (scroll-spy over the anchor ids). */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  useEffect(() => {
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
          else visible.delete(e.target.id);
        }
        const current = ids.find((id) => visible.has(id));
        if (current) setActive(current);
      },
      { rootMargin: '-96px 0px -55% 0px', threshold: [0, 0.1] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids.join('|')]);
  return active;
}

export function WorkspaceNav({
  progress,
  onExpandAll,
  onCollapseAll,
}: {
  progress: Record<SectionId, SectionCompletion>;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  const ids = SECTIONS.map((s) => s.id);
  const active = useActiveSection(ids);
  const phases = phaseTotals(progress);

  const [menuOpen, setMenuOpen] = useState(false);
  const jumpRef = useRef<HTMLDivElement>(null);

  // Close the jump menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (jumpRef.current && !jumpRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function jumpTo(id: string) {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <nav className="workspace-nav" aria-label="Contest sections">
      <ol className="phase-progress">
        {phases.map((p) => (
          <li key={p.id} className={`phase-item phase-${p.state}`}>
            <span className="phase-label">{p.label}</span>
            <span className="phase-count">
              {p.done}/{p.total}
            </span>
          </li>
        ))}
      </ol>

      <div className="ws-nav-actions">
      <div className="ws-nav-jump" ref={jumpRef}>
        <button
          type="button"
          className="ws-nav-trigger"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="ws-nav-trigger-lead">Jump to</span>
          <span className="ws-nav-emoji" aria-hidden>
            {current.emoji}
          </span>
          <span className="ws-nav-trigger-label">{current.label}</span>
          <span className={menuOpen ? 'chevron chevron-open' : 'chevron'} aria-hidden>
            ▼
          </span>
        </button>

        {menuOpen && (
          <ul className="ws-nav-menu" role="menu">
            {SECTIONS.map((s) => {
              const c = s.data ? progress[s.data.key] : undefined;
              const done = c ? c.total > 0 && c.done >= c.total : undefined;
              return (
                <li key={s.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={`ws-nav-item${active === s.id ? ' is-active' : ''}`}
                    onClick={() => jumpTo(s.id)}
                  >
                    <span className="ws-nav-emoji" aria-hidden>
                      {s.emoji}
                    </span>
                    <span className="ws-nav-item-label">{s.label}</span>
                    {c && (
                      <span
                        className={`ws-nav-dot${done ? ' is-done' : ''}`}
                        aria-hidden
                        title={`${c.done}/${c.total}`}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

        <div className="ws-nav-toggle-all">
          <button type="button" onClick={onExpandAll}>
            Expand all
          </button>
          <span className="sep" aria-hidden>
            ·
          </span>
          <button type="button" onClick={onCollapseAll}>
            Collapse all
          </button>
        </div>
      </div>
    </nav>
  );
}
