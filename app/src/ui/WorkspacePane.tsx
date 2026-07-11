import type { ReactNode } from 'react';
import { type Contest, type SectionCompletion, type SectionId } from '../model/contest';
import { EmailComposer } from './EmailComposer';
import { EmailListBox } from './EmailListBox';
import { SchedulePreview } from './SchedulePreview';
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
import { moduleAnchorId, paneModules, type ModuleId, type PaneId } from './paneRegistry';

/**
 * Pane content renderer (PRD #127, Slice R2 #129) — mounts only the selected
 * pane's modules (content-swap, not scroll). A loop over the registry's
 * `paneModules`; the sections are re-parented unchanged, keeping their
 * contest-in/contest-out contracts.
 *
 * Mirrors (Slice R3 #130) render alongside canonical placements: Critique in
 * Judges (fully editable) and the read-only Schedule preview in Setup. They are
 * data-safe because every section is a controlled component over the single
 * autosaved Contest, so both homes edit the same live state. Only canonical
 * placements carry the `sec-<slug>` anchor — Readiness jumps always target the
 * canonical home (`canonicalPane`), and content-swap means the mirror and its
 * canonical twin are never mounted at once anyway.
 */
export function WorkspacePane({
  pane,
  contest,
  progress,
  onChange,
  onOpenSaved,
}: {
  pane: PaneId;
  contest: Contest;
  progress: Record<SectionId, SectionCompletion>;
  onChange: (next: Contest) => void;
  onOpenSaved: (contest: Contest) => void | Promise<void>;
}) {
  return (
    <>
      {paneModules(pane).map(({ module, mirror }) => (
        <div
          key={mirror ? `${module}-mirror` : module}
          id={mirror ? undefined : moduleAnchorId(module)}
          className="ws-section-anchor"
        >
          {renderModule(module, contest, progress, onChange, onOpenSaved)}
        </div>
      ))}
    </>
  );
}

/**
 * ModuleId → its section element. The switch is exhaustive over ModuleId (the
 * `never` default makes a new, unrendered module a compile error), so the registry
 * and the renderer can never silently drift. Sections open by default (Section's
 * own default) — the retired auto-open-first-incomplete behavior does not return.
 */
function renderModule(
  module: ModuleId,
  contest: Contest,
  progress: Record<SectionId, SectionCompletion>,
  onChange: (next: Contest) => void,
  onOpenSaved: (contest: Contest) => void | Promise<void>,
): ReactNode {
  switch (module) {
    case 'cm':
      return <CmInfoSection contest={contest} completion={progress.cm} onChange={onChange} />;
    case 'identity':
      return <IdentitySection contest={contest} completion={progress.identity} onChange={onChange} />;
    case 'details':
      return <DetailsSection contest={contest} completion={progress.details} onChange={onChange} />;
    case 'adjudicators':
      return <AdjudicatorsSection contest={contest} completion={progress.adjudicators} onChange={onChange} />;
    case 'schools':
      return <SchoolsSection contest={contest} completion={progress.schools} onChange={onChange} />;
    case 'plays':
      return <PlaysSection contest={contest} completion={progress.plays} onChange={onChange} />;
    case 'companies':
      return <CompaniesSection contest={contest} onChange={onChange} />;
    case 'draw':
      return <DrawSection contest={contest} onChange={onChange} />;
    case 'compliance':
      return <ComplianceSection contest={contest} onChange={onChange} />;
    case 'schedule':
      return <SchedulePreview contest={contest} />;
    case 'critique':
      return <CritiqueSection contest={contest} onChange={onChange} />;
    case 'results':
      return <ResultsSection contest={contest} onChange={onChange} onAdvance={onOpenSaved} />;
    case 'generate':
      return <GenerateSection contest={contest} onChange={onChange} />;
    case 'history':
      return <HistorySection contest={contest} onRestore={onChange} />;
    case 'email':
      return (
        <>
          <EmailComposer contest={contest} />
          <EmailListBox contest={contest} />
        </>
      );
    default: {
      const unreached: never = module;
      return unreached;
    }
  }
}
