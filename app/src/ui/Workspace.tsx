import { useEffect, useState } from 'react';
import {
  contestDisplayName,
  sectionCompletion,
  validateContest,
  type Contest,
  type SectionId,
} from '../model/contest';
import { getContest } from '../storage/contestStore';
import { useAutosave } from '../storage/useAutosave';
import { EmailComposer } from './EmailComposer';
import { EmailListBox } from './EmailListBox';
import { AdjudicatorsSection } from './sections/AdjudicatorsSection';
import { CmInfoSection } from './sections/CmInfoSection';
import { CompaniesSection } from './sections/CompaniesSection';
import { ComplianceSection } from './sections/ComplianceSection';
import { CritiqueSection } from './sections/CritiqueSection';
import { DetailsSection } from './sections/DetailsSection';
import { DrawSection } from './sections/DrawSection';
import { GenerateSection } from './sections/GenerateSection';
import { HistorySection } from './sections/HistorySection';
import { IdentitySection } from './sections/IdentitySection';
import { PlaysSection } from './sections/PlaysSection';
import { ResultsSection } from './sections/ResultsSection';
import { SchoolsSection } from './sections/SchoolsSection';
import { SectionOpenContext, type SectionOpenSignal } from './sections/Section';
import { SchedulePreview } from './SchedulePreview';
import { WorkspaceNav } from './WorkspaceNav';

/**
 * Contest workspace — all v12 data-entry sections. Pattern to keep: state
 * lives in one `Contest` value, every change goes through the model's
 * update helpers (sections receive the contest and hand back the next one),
 * and useAutosave persists it — components never talk to IndexedDB directly.
 */
export function Workspace({
  contestId,
  draft,
  onBack,
  onOpenSaved,
}: {
  contestId: string;
  /** Fresh unsaved contest from "+ New Contest" — not in storage yet. */
  draft?: Contest;
  onBack: () => void;
  /** Persist a brand-new contest (e.g. the advance-clone) and open it. */
  onOpenSaved: (contest: Contest) => void | Promise<void>;
}) {
  const [contest, setContest] = useState<Contest>();
  const [missing, setMissing] = useState(false);
  // Global expand/collapse-all signal broadcast to every Section via context.
  const [openSignal, setOpenSignal] = useState<SectionOpenSignal | null>(null);
  const setAllSections = (open: boolean) =>
    setOpenSignal((s) => ({ open, nonce: (s?.nonce ?? 0) + 1 }));

  useEffect(() => {
    if (draft && draft.id === contestId) {
      setContest(draft);
      return;
    }
    void getContest(contestId).then((c) => (c ? setContest(c) : setMissing(true)));
  }, [contestId, draft]);

  useAutosave(contest);

  if (missing) {
    return (
      <main className="page">
        <p>Contest not found.</p>
        <button className="btn-ghost" onClick={onBack}>← Back to dashboard</button>
      </main>
    );
  }
  if (!contest) return <main className="page"><p className="muted">Loading…</p></main>;

  const progress = sectionCompletion(contest);
  const issues = validateContest(contest);

  // Default collapse behavior (Slice 16): open the first data-entry section that
  // still has empty fields and collapse the rest, guiding the CM to the next
  // thing needing attention. A fully-complete contest opens none — the nav and
  // tool sections carry the flow from there. Computed once at mount, like the
  // Section's own open state, so toggling a section by hand always wins after.
  const dataOrder: SectionId[] = ['cm', 'identity', 'details', 'adjudicators', 'schools', 'plays'];
  const firstIncomplete = dataOrder.find((k) => progress[k].done < progress[k].total);
  const openFirst = (k: SectionId) => k === firstIncomplete;

  return (
    <SectionOpenContext.Provider value={openSignal}>
    <main className="page">
      <header className="page-header">
        <button className="btn-ghost" onClick={onBack}>← All contests</button>
        <h1>{contestDisplayName(contest.identity)}</h1>
        <p className="subtitle">Every change saves automatically.</p>
      </header>

      <WorkspaceNav
        progress={progress}
        onExpandAll={() => setAllSections(true)}
        onCollapseAll={() => setAllSections(false)}
      />

      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((issue) => (
            <li key={issue.field}>⚠️ {issue.message}</li>
          ))}
        </ul>
      )}

      <div id="sec-cm" className="ws-section-anchor">
        <CmInfoSection contest={contest} completion={progress.cm} onChange={setContest} defaultOpen={openFirst('cm')} />
      </div>
      <div id="sec-identity" className="ws-section-anchor">
        <IdentitySection contest={contest} completion={progress.identity} onChange={setContest} defaultOpen={openFirst('identity')} />
      </div>
      <div id="sec-details" className="ws-section-anchor">
        <DetailsSection contest={contest} completion={progress.details} onChange={setContest} defaultOpen={openFirst('details')} />
      </div>
      <div id="sec-adjudicators" className="ws-section-anchor">
        <AdjudicatorsSection contest={contest} completion={progress.adjudicators} onChange={setContest} defaultOpen={openFirst('adjudicators')} />
      </div>
      <div id="sec-schools" className="ws-section-anchor">
        <SchoolsSection contest={contest} completion={progress.schools} onChange={setContest} defaultOpen={openFirst('schools')} />
      </div>
      <div id="sec-plays" className="ws-section-anchor">
        <PlaysSection contest={contest} completion={progress.plays} onChange={setContest} defaultOpen={openFirst('plays')} />
      </div>
      <div id="sec-companies" className="ws-section-anchor">
        <CompaniesSection contest={contest} onChange={setContest} />
      </div>
      <div id="sec-draw" className="ws-section-anchor">
        <DrawSection contest={contest} onChange={setContest} />
      </div>
      <div id="sec-compliance" className="ws-section-anchor">
        <ComplianceSection contest={contest} onChange={setContest} />
      </div>
      <div id="sec-schedule" className="ws-section-anchor">
        <SchedulePreview contest={contest} />
      </div>
      <div id="sec-critique" className="ws-section-anchor">
        <CritiqueSection contest={contest} onChange={setContest} />
      </div>
      <div id="sec-results" className="ws-section-anchor">
        <ResultsSection contest={contest} onChange={setContest} onAdvance={onOpenSaved} />
      </div>
      <div id="sec-generate" className="ws-section-anchor">
        <GenerateSection contest={contest} onChange={setContest} />
      </div>
      <div id="sec-history" className="ws-section-anchor">
        <HistorySection contest={contest} onRestore={setContest} />
      </div>
      <div id="sec-email" className="ws-section-anchor">
        <EmailComposer contest={contest} />
      </div>
      <EmailListBox contest={contest} />
    </main>
    </SectionOpenContext.Provider>
  );
}
