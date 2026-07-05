import { useEffect, useState } from 'react';
import {
  CLASSIFICATIONS,
  CONTEST_LEVELS,
  contestDisplayName,
  contestNamePreview,
  validateContest,
  withIdentity,
  type Contest,
  type ContestIdentity,
} from '../model/contest';
import { getContest } from '../storage/contestStore';
import { useAutosave } from '../storage/useAutosave';

/**
 * Contest workspace. Slice 1 shows only the Contest Identity section; later
 * slices add the remaining sections (details, adjudicators, schools, plays,
 * documents). Pattern to keep: state lives in one `Contest` value, every
 * change goes through the model's withIdentity()-style helpers, and
 * useAutosave persists it — components never talk to IndexedDB directly.
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

  const { identity } = contest;
  const issues = validateContest(contest);
  const edit = (patch: Partial<ContestIdentity>) => setContest(withIdentity(contest, patch));

  return (
    <main className="page">
      <header className="page-header">
        <button className="btn-ghost" onClick={onBack}>← All contests</button>
        <h1>{contestDisplayName(identity)}</h1>
        <p className="subtitle">Every change saves automatically.</p>
      </header>

      <section className="section">
        <h2>📋 Contest Identity</h2>
        <div className="field-grid">
          <label className="field">
            Contest Year
            <input
              value={identity.contestYear}
              onChange={(e) => edit({ contestYear: e.target.value })}
            />
          </label>
          <label className="field">
            Contest Level
            <select
              value={identity.contestLevel}
              onChange={(e) => edit({ contestLevel: e.target.value as ContestIdentity['contestLevel'] })}
            >
              {CONTEST_LEVELS.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Classification
            <select
              value={identity.classification}
              onChange={(e) => edit({ classification: e.target.value as ContestIdentity['classification'] })}
            >
              {CLASSIFICATIONS.map((cls) => (
                <option key={cls}>{cls}</option>
              ))}
            </select>
          </label>
          <label className="field">
            District / Zone / Area Number
            <input
              placeholder="e.g. 20"
              value={identity.districtNumber}
              onChange={(e) => edit({ districtNumber: e.target.value })}
            />
          </label>
          <label className="field">
            Contest Name Preview
            <input readOnly value={contestNamePreview(identity)} />
          </label>
          <label className="field">
            Host School Name
            <input
              placeholder="e.g. Friendswood High School"
              value={identity.hostSchoolName}
              onChange={(e) => edit({ hostSchoolName: e.target.value })}
            />
          </label>
          <label className="field">
            Venue / Auditorium Name
            <input
              placeholder="e.g. Friendswood PAC"
              value={identity.hostVenueName}
              onChange={(e) => edit({ hostVenueName: e.target.value })}
            />
          </label>
          <label className="field field-wide">
            Venue Street Address
            <input
              placeholder="e.g. 702 Greenbriar Dr. Friendswood, Texas 77546"
              value={identity.hostAddress}
              onChange={(e) => edit({ hostAddress: e.target.value })}
            />
          </label>
        </div>
        {issues.length > 0 && (
          <ul className="issues">
            {issues.map((issue) => (
              <li key={issue.field}>⚠️ {issue.message}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
