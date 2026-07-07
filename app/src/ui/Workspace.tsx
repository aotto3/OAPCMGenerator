import { useEffect, useState } from 'react';
import {
  contestDisplayName,
  sectionCompletion,
  validateContest,
  type Contest,
} from '../model/contest';
import { getContest } from '../storage/contestStore';
import { useAutosave } from '../storage/useAutosave';
import { EmailComposer } from './EmailComposer';
import { EmailListBox } from './EmailListBox';
import { AdjudicatorsSection } from './sections/AdjudicatorsSection';
import { CmInfoSection } from './sections/CmInfoSection';
import { CritiqueSection } from './sections/CritiqueSection';
import { DetailsSection } from './sections/DetailsSection';
import { DocumentsSection } from './sections/DocumentsSection';
import { GenerateSection } from './sections/GenerateSection';
import { IdentitySection } from './sections/IdentitySection';
import { PlaysSection } from './sections/PlaysSection';
import { SchoolsSection } from './sections/SchoolsSection';
import { SchedulePreview } from './SchedulePreview';

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
}: {
  contestId: string;
  /** Fresh unsaved contest from "+ New Contest" — not in storage yet. */
  draft?: Contest;
  onBack: () => void;
}) {
  const [contest, setContest] = useState<Contest>();
  const [missing, setMissing] = useState(false);

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

  return (
    <main className="page">
      <header className="page-header">
        <button className="btn-ghost" onClick={onBack}>← All contests</button>
        <h1>{contestDisplayName(contest.identity)}</h1>
        <p className="subtitle">Every change saves automatically.</p>
      </header>

      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((issue) => (
            <li key={issue.field}>⚠️ {issue.message}</li>
          ))}
        </ul>
      )}

      <CmInfoSection contest={contest} completion={progress.cm} onChange={setContest} />
      <IdentitySection contest={contest} completion={progress.identity} onChange={setContest} />
      <DetailsSection contest={contest} completion={progress.details} onChange={setContest} />
      <AdjudicatorsSection contest={contest} completion={progress.adjudicators} onChange={setContest} />
      <SchoolsSection contest={contest} completion={progress.schools} onChange={setContest} />
      <PlaysSection contest={contest} completion={progress.plays} onChange={setContest} />
      <SchedulePreview contest={contest} />
      <CritiqueSection contest={contest} onChange={setContest} />
      <DocumentsSection contest={contest} onChange={setContest} />
      <GenerateSection contest={contest} />
      <EmailComposer contest={contest} />
      <EmailListBox contest={contest} />
    </main>
  );
}
