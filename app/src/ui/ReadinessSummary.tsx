import { readinessReport } from '../model/readiness';
import type { Contest } from '../model/contest';

/**
 * Compact readiness summary shown in the workspace (PRD #75 user story 18): the
 * overall red/yellow/green counter plus a per-phase chip row, and a button into
 * the full Readiness page. Glanceable status without leaving data entry. Pure
 * presentation over `readinessReport` — no readiness logic of its own.
 */
export function ReadinessSummary({ contest, onOpen }: { contest: Contest; onOpen: () => void }) {
  const report = readinessReport(contest);
  return (
    <div className="readiness-summary">
      <div className="readiness-summary-main">
        <span className={`readiness-counter is-${report.color}`} title="Applicable items resolved">
          {report.done}/{report.applicable} ready
        </span>
        <span className="readiness-summary-label">Contest readiness</span>
        <button type="button" className="btn-util readiness-summary-open" onClick={onOpen}>
          Readiness page →
        </button>
      </div>
      <ol className="readiness-summary-phases">
        {report.phases.map((p) => (
          <li key={p.phase} className={`readiness-chip is-${p.color}`} title={`${p.done}/${p.applicable} resolved`}>
            <span className="readiness-chip-label">{p.label}</span>
            <span className="readiness-chip-count">
              {p.done}/{p.applicable}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
