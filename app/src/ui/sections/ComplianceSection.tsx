import { useState } from 'react';
import {
  COMPLIANCE_STATUSES,
  addComplianceItem,
  complianceItems,
  complianceProgress,
  removeComplianceItem,
  setComplianceStatus,
  type ComplianceStatus,
  type Contest,
} from '../../model/contest';
import { Section } from './Section';

/**
 * Compliance tracker (PRD #64, Group A). A schools × items grid where the CM
 * records which handbook paperwork each school has turned in — Pending /
 * Received / N/A per cell — with a colored progress counter per school.
 *
 * Deliberately additive and optional (user story 12): the section defaults
 * collapsed, holds no state but the "new custom item" text box, and reads/writes
 * only through the pure model helpers (complianceProgress + the with*()-style
 * updaters from Slice A1), so autosave/sync/export carry it with no plumbing of
 * their own. Progress shows nowhere outside this section.
 */

const STATUS_LABELS: Record<ComplianceStatus, string> = {
  pending: 'Pending',
  received: 'Received',
  na: 'N/A',
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
        Track the handbook paperwork each school owes before contest day. Some items apply only in
        certain cases — mark them <strong>N/A</strong> when they don't apply: <em>“Scenes from” / cutting
        permission</em> (only for a cut script), <em>Play approval</em> (only for off-list titles), and{' '}
        <em>Scenic approval</em> (only for special set pieces). N/A items drop out of a school's counter.
        This tracker is just for you — it never blocks anything or appears in a generated document.
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
              return (
                <tr key={i}>
                  <th scope="row" className="compliance-school">
                    {school.name.trim() || `School ${i + 1}`}
                  </th>
                  {items.map((item) => {
                    const status = school.compliance[item.id] ?? 'pending';
                    return (
                      <td key={item.id} className="compliance-cell">
                        <select
                          className={`compliance-select is-${status}`}
                          aria-label={`${school.name.trim() || `School ${i + 1}`} — ${item.label}`}
                          value={status}
                          onChange={(e) =>
                            onChange(setComplianceStatus(contest, i, item.id, e.target.value as ComplianceStatus))
                          }
                        >
                          {COMPLIANCE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
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
