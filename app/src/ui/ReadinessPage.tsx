import { useState } from 'react';
import {
  READINESS_STATUSES,
  addReadinessItem,
  removeReadinessItem,
  setReadinessStatus,
  type Contest,
  type ReadinessPhase,
  type ReadinessStatus,
} from '../model/contest';
import { readinessReport, type ReadinessReportItem } from '../model/readiness';

/**
 * Contest Readiness hub (PRD #75, Group G; re-homed by #127). The itemized
 * expansion of the readiness model, now rendered as the Readiness destination's
 * content INSIDE the workspace shell — the sidebar and workspace header stay
 * visible, so it is a selected pane, not a full-page takeover. A THIN renderer
 * over the pure `readinessReport`: it holds no readiness logic, only the "add
 * custom item" form state. Derived items are read-only with a jump link (switches
 * to the owning pane and scrolls); manual/custom items are tri-state controls
 * bound to G1's updaters, so every edit rides the same autosave/sync/export
 * plumbing. Screen-only — the print button is the paper fallback.
 */

const STATUS_LABELS: Record<ReadinessStatus, string> = {
  pending: 'Pending',
  done: 'Done',
  na: 'N/A',
};

export function ReadinessPage({
  contest,
  onChange,
  onJump,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
  /** Jump to a module: switches to its canonical pane and scrolls to the anchor. */
  onJump: (sectionId: string) => void;
}) {
  const report = readinessReport(contest);
  const [newLabel, setNewLabel] = useState('');
  const [newPhase, setNewPhase] = useState<ReadinessPhase>(report.phases[0].phase);

  function handleAdd() {
    const label = newLabel.trim();
    if (!label) return;
    onChange(addReadinessItem(contest, { id: crypto.randomUUID(), label, phase: newPhase }));
    setNewLabel('');
  }

  return (
    <div className="readiness-pane">
      <div className="readiness-topbar">
        <h2 className="readiness-pane-title">Contest Readiness</h2>
        <span className={`readiness-counter is-${report.color}`} title="Applicable items resolved">
          {report.done}/{report.applicable} ready
        </span>
        <button type="button" className="btn-util" onClick={() => window.print()}>
          🖨 Print
        </button>
      </div>

      {report.phases.map((phase) => (
        <section key={phase.phase} className="readiness-phase">
          <header className="readiness-phase-head">
            <h2>{phase.label}</h2>
            <span className={`readiness-counter is-${phase.color}`} title="Applicable items resolved">
              {phase.done}/{phase.applicable}
            </span>
          </header>
          <ul className="readiness-items">
            {phase.items.map((item) => (
              <ReadinessItemRow key={item.id} contest={contest} item={item} onChange={onChange} onJump={onJump} />
            ))}
          </ul>
        </section>
      ))}

      <div className="readiness-add no-print">
        <input
          type="text"
          placeholder="Add a custom item (e.g. Parking arranged)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <select
          className="readiness-phase-picker"
          aria-label="Phase for the new item"
          value={newPhase}
          onChange={(e) => setNewPhase(e.target.value as ReadinessPhase)}
        >
          {report.phases.map((p) => (
            <option key={p.phase} value={p.phase}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn-util" disabled={!newLabel.trim()} onClick={handleAdd}>
          + Add item
        </button>
      </div>
    </div>
  );
}

/** One report item: read-only for derived, a tri-state control for manual/custom. */
function ReadinessItemRow({
  contest,
  item,
  onChange,
  onJump,
}: {
  contest: Contest;
  item: ReadinessReportItem;
  onChange: (next: Contest) => void;
  onJump: (sectionId: string) => void;
}) {
  const countText = item.count ? ` — ${item.count.done}/${item.count.total}` : '';

  if (item.kind === 'derived') {
    return (
      <li className={`readiness-item is-derived is-${item.status}`}>
        <span className="readiness-mark" aria-hidden>
          {item.status === 'done' ? '✓' : '○'}
        </span>
        <span className="readiness-item-label">
          {item.label}
          <span className="readiness-item-count">{countText}</span>
        </span>
        {item.section && (
          <button type="button" className="readiness-jump no-print" onClick={() => onJump(item.section!)}>
            Go to section →
          </button>
        )}
      </li>
    );
  }

  return (
    <li className={`readiness-item is-${item.kind} is-${item.status}`}>
      <select
        className={`readiness-select is-${item.status}`}
        aria-label={item.label}
        value={item.status}
        onChange={(e) => onChange(setReadinessStatus(contest, item.id, e.target.value as ReadinessStatus))}
      >
        {READINESS_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <span className="readiness-item-label">{item.label}</span>
      {item.kind === 'custom' && (
        <button
          type="button"
          className="readiness-remove no-print"
          title={`Remove custom item “${item.label}”`}
          aria-label={`Remove custom item ${item.label}`}
          onClick={() => onChange(removeReadinessItem(contest, item.id))}
        >
          ×
        </button>
      )}
    </li>
  );
}
