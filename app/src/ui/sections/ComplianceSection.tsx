import { useState } from 'react';
import {
  APPROVED_LIST_NA_ITEMS,
  addComplianceItem,
  complianceItems,
  complianceProgress,
  effectiveComplianceStatus,
  isOnApprovedList,
  removeComplianceItem,
  setComplianceStatus,
  setOnApprovedList,
  type ComplianceStatus,
  type Contest,
} from '../../model/contest';
import { Section } from './Section';

/**
 * Compliance tracker (PRD #64, Group A; quick-edit + approved-list — feedback
 * 2026-07-11). A schools × items grid where the CM records which handbook
 * paperwork each school has turned in. Each cell is a click-to-cycle chip
 * (Pending → Received → N/A) — one tap for the common case, color-coded so the
 * grid scans at a glance — with a colored progress counter per school.
 *
 * A per-school "On the UIL approved list" toggle auto-N/As the license / cutting
 * permission / off-list approval items (APPROVED_LIST_NA_ITEMS) and locks those
 * chips, so an approved play clears its inapplicable paperwork in one click.
 *
 * Deliberately additive and optional (user story 12): reads/writes only through
 * the pure model helpers, so autosave/sync/export carry it with no plumbing of
 * their own. Progress shows nowhere outside this section.
 */

const STATUS_LABELS: Record<ComplianceStatus, string> = {
  pending: 'Pending',
  received: 'Received',
  na: 'N/A',
};

/** Compact chip glyph per state; color carries the rest. */
const STATUS_GLYPH: Record<ComplianceStatus, string> = {
  pending: '—',
  received: '✓',
  na: 'N/A',
};

/** One click advances a cell to the next state. */
const NEXT_STATUS: Record<ComplianceStatus, ComplianceStatus> = {
  pending: 'received',
  received: 'na',
  na: 'pending',
};

export function ComplianceSection({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  const [newItemLabel, setNewItemLabel] = useState('');

  const items = complianceItems(contest);
  const customIds = new Set(contest.customComplianceItems.map((it) => it.id));

  function handleAddItem() {
    const label = newItemLabel.trim();
    if (!label) return;
    onChange(addComplianceItem(contest, { id: crypto.randomUUID(), label }));
    setNewItemLabel('');
  }

  return (
    <Section title="✅ Compliance" badge="Optional Tracker" defaultOpen={false}>
      <p className="note-box">
        Track the handbook paperwork each school owes before contest day.{' '}
        <strong>Click a cell to cycle</strong> Pending → Received → N/A. Mark an item{' '}
        <strong>N/A</strong> when it doesn't apply — N/A items drop out of a school's counter. If a play is
        on the <strong>UIL approved list</strong>, tick that box to auto-N/A the publisher license, cutting
        permission, and off-list approval at once. This tracker is just for you — it never blocks anything or
        appears in a generated document.
      </p>

      <div className="compliance-scroll">
        <table className="compliance-grid">
          <thead>
            <tr>
              <th className="compliance-corner">School</th>
              {items.map((item) => (
                <th key={item.id} className="compliance-item-head">
                  <span>{item.label}</span>
                  {customIds.has(item.id) && (
                    <button
                      type="button"
                      className="compliance-remove"
                      title={`Remove custom item “${item.label}”`}
                      aria-label={`Remove custom item ${item.label}`}
                      onClick={() => onChange(removeComplianceItem(contest, item.id))}
                    >
                      ×
                    </button>
                  )}
                </th>
              ))}
              <th className="compliance-progress-head">Progress</th>
            </tr>
          </thead>
          <tbody>
            {contest.schools.map((school, i) => {
              const progress = complianceProgress(school, items);
              const schoolName = school.name.trim() || `School ${i + 1}`;
              const approved = isOnApprovedList(school);
              return (
                <tr key={i}>
                  <th scope="row" className="compliance-school">
                    <span className="compliance-school-name">{schoolName}</span>
                    <label className="compliance-approved">
                      <input
                        type="checkbox"
                        checked={approved}
                        onChange={(e) => onChange(setOnApprovedList(contest, i, e.target.checked))}
                      />
                      On approved list
                    </label>
                  </th>
                  {items.map((item) => {
                    const status = effectiveComplianceStatus(school, item.id);
                    const locked = approved && APPROVED_LIST_NA_ITEMS.includes(item.id);
                    return (
                      <td key={item.id} className="compliance-cell">
                        <button
                          type="button"
                          className={`compliance-chip is-${status}${locked ? ' is-locked' : ''}`}
                          disabled={locked}
                          aria-label={
                            `${schoolName} — ${item.label}: ${STATUS_LABELS[status]}` +
                            (locked ? ' (auto — play on approved list)' : '. Click to change.')
                          }
                          title={
                            locked
                              ? 'Auto N/A — play is on the approved list'
                              : `${STATUS_LABELS[status]} — click to change`
                          }
                          onClick={() =>
                            onChange(setComplianceStatus(contest, i, item.id, NEXT_STATUS[status]))
                          }
                        >
                          {STATUS_GLYPH[status]}
                        </button>
                      </td>
                    );
                  })}
                  <td className="compliance-progress">
                    <span className={`compliance-counter is-${progress.color}`} title="Applicable items received">
                      {progress.done}/{progress.applicable}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="compliance-add">
        <input
          type="text"
          placeholder="Add a custom item (e.g. Proof of insurance)"
          value={newItemLabel}
          onChange={(e) => setNewItemLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddItem();
            }
          }}
        />
        <button type="button" className="btn-util" disabled={!newItemLabel.trim()} onClick={handleAddItem}>
          + Add item
        </button>
      </div>
    </Section>
  );
}
