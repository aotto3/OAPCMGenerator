import { useState } from 'react';
import {
  addAwardWinner,
  advanceContest,
  advancingPlaceCount,
  AWARD_LIST_CAPS,
  canAdvanceContest,
  CLASSIFICATIONS,
  clearResults,
  nextContestLevel,
  removeAwardWinner,
  removeOutstandingTechnician,
  setAdvancing,
  setAlternate,
  setBestCrew,
  setOutstandingTechnician,
  withNextContest,
  type AwardListCategory,
  type Classification,
  type Contest,
} from '../../model/contest';
import { Section } from './Section';
import { TextField } from './fields';

/**
 * Results & Advancement (PRD #66, Group C). Post-contest entry for the awards
 * outcome and the next-level handoff, plus the one-click advance-clone.
 *
 * Everything here writes through the pure C1 updaters (hard caps enforced there)
 * and the always-present `nextContest` block, so autosave/sync/export carry it
 * with no plumbing of its own — and a CM who never opens this section leaves
 * `results === null`, which the Awards Script reads as "emit the blank template".
 *
 * The advance-clone runs C3's pure `advanceContest()` to spin the advancing
 * companies up a level as a SEPARATE new contest record (via `onAdvance`, which
 * saves it and opens it); it is unavailable at Region (no managed next level).
 *
 * Rank is stored (advancing is an ordered array) but NEVER surfaced: the picker
 * is an unordered capped checkbox set, and every consumer announces the advancing
 * companies in no particular order.
 *
 * The acting/tech award pickers are plain school-dropdown + typed name here; the
 * roster-backed comboboxes (the C↔E seam, PRD #66 / #68) land as the final step
 * of whichever of Group C / Group E ships second — Group E has not shipped.
 */

/** Display label for the level a contest advances to (mirrors the Awards Script). */
const NEXT_LEVEL_LABEL: Record<string, string> = {
  Zone: 'District',
  District: 'Bi-District',
  BiDistrict: 'Area',
  Area: 'Region',
  Region: 'State',
};

/** The three count-capped acting-award lists, in ceremony order. */
const ACTING_AWARDS: { category: AwardListCategory; label: string }[] = [
  { category: 'bestPerformers', label: 'Best Performers' },
  { category: 'allStarCast', label: 'All-Star Cast' },
  { category: 'honorableMention', label: 'Honorable Mention All-Star Cast' },
];

/** Form-state for the advance-clone dialog (null ⇒ closed). */
interface AdvanceForm {
  classification: Classification;
  contestYear: string;
  seed: boolean;
}

export function ResultsSection({
  contest,
  onChange,
  onAdvance,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
  /** Persist the advanced contest as a new record and open it. */
  onAdvance: (advanced: Contest) => void | Promise<void>;
}) {
  const results = contest.results;
  const schools = contest.schools;
  const schoolLabel = (i: number) => schools[i]?.name.trim() || `School ${i + 1}`;

  // Per-category "add winner" draft rows (school + typed name), local UI state.
  const [drafts, setDrafts] = useState<Record<AwardListCategory, { schoolIndex: string; name: string }>>({
    bestPerformers: { schoolIndex: '', name: '' },
    allStarCast: { schoolIndex: '', name: '' },
    honorableMention: { schoolIndex: '', name: '' },
  });
  const [advanceForm, setAdvanceForm] = useState<AdvanceForm | null>(null);

  const advancing = results?.advancing ?? [];
  const advCount = advancingPlaceCount(contest.identity.contestLevel);
  const advFull = advancing.length >= advCount;
  const alternate = results?.alternate ?? null;
  const bestCrew = results?.bestCrew ?? null;

  const nextLevel = nextContestLevel(contest.identity.contestLevel);
  const nextLabel = nextLevel ? NEXT_LEVEL_LABEL[contest.identity.contestLevel] ?? nextLevel : null;

  /** School <select> with a blank "none" option. `value` is a school index or null. */
  function SchoolSelect({
    id,
    value,
    onPick,
  }: {
    id: string;
    value: number | null;
    onPick: (index: number | null) => void;
  }) {
    return (
      <select
        id={id}
        className="results-school-select"
        value={value === null ? '' : String(value)}
        onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">— none —</option>
        {schools.map((_, i) => (
          <option key={i} value={i}>
            {schoolLabel(i)}
          </option>
        ))}
      </select>
    );
  }

  function toggleAdvancing(i: number) {
    const has = advancing.includes(i);
    if (!has && advFull) return; // at the cap — ignore extra checks
    const next = has ? advancing.filter((x) => x !== i) : [...advancing, i];
    onChange(setAdvancing(contest, next));
  }

  function setTechnician(i: number, name: string) {
    onChange(name.trim() ? setOutstandingTechnician(contest, i, name) : removeOutstandingTechnician(contest, i));
  }

  function addWinner(category: AwardListCategory) {
    const draft = drafts[category];
    if (draft.schoolIndex === '' || !draft.name.trim()) return;
    onChange(addAwardWinner(contest, category, { studentName: draft.name.trim(), schoolIndex: Number(draft.schoolIndex) }));
    setDrafts((d) => ({ ...d, [category]: { schoolIndex: '', name: '' } }));
  }

  function openAdvance() {
    setAdvanceForm({
      classification: contest.identity.classification,
      contestYear: contest.identity.contestYear,
      seed: true,
    });
  }

  function confirmAdvance() {
    if (!advanceForm) return;
    const advanced = advanceContest(contest, {
      identity: { classification: advanceForm.classification, contestYear: advanceForm.contestYear },
      seedFromNextContest: advanceForm.seed,
    });
    if (advanced) void onAdvance(advanced);
    setAdvanceForm(null);
  }

  const nc = contest.nextContest;

  return (
    <Section title="🏆 Results & Advancement" badge="After Contest Day" defaultOpen={false}>
      <p className="note-box">
        Record the contest outcome after adjudication. Advancing companies are announced in{' '}
        <strong>no particular order</strong> — the placement you enter is stored for your reference but
        never printed. Everything here fills the <strong>Awards Script</strong>; leave it blank and the
        script prints its fill-in template as before. Nothing else in the app changes.
      </p>

      <div className="section-divider">Advancing Companies</div>
      <p className="hint">
        Select the {advCount} advancing {advCount === 1 ? 'company' : 'companies'} for this level. Order
        does not matter.
      </p>
      <div className="results-check-grid">
        {schools.map((_, i) => {
          const checked = advancing.includes(i);
          return (
            <label key={i} className="results-check">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && advFull}
                onChange={() => toggleAdvancing(i)}
              />{' '}
              {schoolLabel(i)}
            </label>
          );
        })}
      </div>

      <div className="results-field-row">
        <label className="field" htmlFor="results-alternate">
          Alternate
          <SchoolSelect id="results-alternate" value={alternate} onPick={(v) => onChange(setAlternate(contest, v))} />
        </label>
        <label className="field" htmlFor="results-best-crew">
          Best Crew
          <SchoolSelect id="results-best-crew" value={bestCrew} onPick={(v) => onChange(setBestCrew(contest, v))} />
        </label>
      </div>

      <div className="section-divider">Acting Awards</div>
      {ACTING_AWARDS.map(({ category, label }) => {
        const winners = results?.[category] ?? [];
        const cap = AWARD_LIST_CAPS[category];
        const draft = drafts[category];
        return (
          <div key={category} className="results-award-block">
            <h4 className="results-award-title">
              {label} <span className="muted">({winners.length}/{cap})</span>
            </h4>
            {winners.length > 0 && (
              <ul className="results-winner-list">
                {winners.map((w, i) => (
                  <li key={i} className="results-winner">
                    <span>
                      <strong>{w.studentName}</strong> — {schoolLabel(w.schoolIndex)}
                    </span>
                    <button
                      type="button"
                      className="results-remove"
                      aria-label={`Remove ${w.studentName}`}
                      onClick={() => onChange(removeAwardWinner(contest, category, i))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {winners.length < cap ? (
              <div className="results-add-row">
                <select
                  className="results-school-select"
                  aria-label={`${label} — school`}
                  value={draft.schoolIndex}
                  onChange={(e) => setDrafts((d) => ({ ...d, [category]: { ...d[category], schoolIndex: e.target.value } }))}
                >
                  <option value="">— school —</option>
                  {schools.map((_, i) => (
                    <option key={i} value={i}>
                      {schoolLabel(i)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  className="results-name-input"
                  placeholder="Student name"
                  aria-label={`${label} — student name`}
                  value={draft.name}
                  onChange={(e) => setDrafts((d) => ({ ...d, [category]: { ...d[category], name: e.target.value } }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addWinner(category);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-util"
                  disabled={draft.schoolIndex === '' || !draft.name.trim()}
                  onClick={() => addWinner(category)}
                >
                  + Add
                </button>
              </div>
            ) : (
              <p className="hint">Maximum of {cap} reached.</p>
            )}
          </div>
        );
      })}

      <div className="section-divider">Outstanding Technicians</div>
      <p className="hint">At most one per school — leave blank for schools with no technician award.</p>
      <div className="results-tech-grid">
        {schools.map((_, i) => (
          <label key={i} className="field">
            {schoolLabel(i)}
            <input
              type="text"
              placeholder="Technician name"
              value={results?.outstandingTechnicians.find((w) => w.schoolIndex === i)?.studentName ?? ''}
              onChange={(e) => setTechnician(i, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="section-divider">Next Level of Competition</div>
      <p className="hint">
        Fills the Awards Script's Next-Level section and pre-seeds the advance-clone below.
      </p>
      <div className="results-field-row">
        <TextField
          label="Date"
          type="date"
          value={nc.date}
          onChange={(v) => onChange(withNextContest(contest, { date: v }))}
        />
        <TextField
          label="Location"
          value={nc.location}
          onChange={(v) => onChange(withNextContest(contest, { location: v }))}
          placeholder="e.g. Regional Arts Center, Austin"
        />
      </div>
      <div className="results-field-row">
        <TextField
          label="Next Contest Manager"
          value={nc.cmName}
          onChange={(v) => onChange(withNextContest(contest, { cmName: v }))}
        />
        <TextField
          label="CM Email"
          type="email"
          value={nc.cmEmail}
          onChange={(v) => onChange(withNextContest(contest, { cmEmail: v }))}
        />
        <TextField
          label="CM Phone"
          type="tel"
          value={nc.cmPhone}
          onChange={(v) => onChange(withNextContest(contest, { cmPhone: v }))}
        />
      </div>

      <div className="section-divider">Advance to Next Level</div>
      {nextLevel === null ? (
        <p className="hint results-advance-blocked">
          This is the Region level — the next level (State) is run by UIL, so there is no advance-clone here.
        </p>
      ) : advanceForm ? (
        <div className="results-advance-dialog">
          <p>
            Create a new <strong>{nextLabel}</strong> contest carrying the{' '}
            <strong>{advancing.length}</strong> advancing{' '}
            {advancing.length === 1 ? 'company' : 'companies'} (with their plays and directors). The
            source contest is left untouched.
          </p>
          <div className="results-field-row">
            <label className="field" htmlFor="advance-classification">
              Classification
              <select
                id="advance-classification"
                value={advanceForm.classification}
                onChange={(e) => setAdvanceForm({ ...advanceForm, classification: e.target.value as Classification })}
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <TextField
              label="Contest Year"
              value={advanceForm.contestYear}
              onChange={(v) => setAdvanceForm({ ...advanceForm, contestYear: v })}
            />
          </div>
          <label className="results-seed-check">
            <input
              type="checkbox"
              checked={advanceForm.seed}
              onChange={(e) => setAdvanceForm({ ...advanceForm, seed: e.target.checked })}
            />{' '}
            Pre-seed the new contest's date, location, and CM from the Next-Level info above
          </label>
          <p className="hint">
            District number and host school/venue reset — the {nextLabel} host fills those in.
          </p>
          <div className="results-advance-actions">
            <button type="button" className="btn-primary" disabled={advancing.length === 0} onClick={confirmAdvance}>
              🏆 Create {nextLabel} Contest
            </button>
            <button type="button" className="btn-util" onClick={() => setAdvanceForm(null)}>
              Cancel
            </button>
          </div>
          {advancing.length === 0 && (
            <p className="hint">Select at least one advancing company first.</p>
          )}
        </div>
      ) : (
        <div className="results-advance-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!canAdvanceContest(contest) || advancing.length === 0}
            onClick={openAdvance}
          >
            🏆 Advance to {nextLabel} →
          </button>
          {advancing.length === 0 && (
            <p className="hint">Select the advancing companies above to enable this.</p>
          )}
        </div>
      )}

      {results !== null && (
        <div className="results-clear-row">
          <button
            type="button"
            className="btn-util"
            onClick={() => {
              if (window.confirm('Clear all recorded results? The Awards Script returns to its blank fill-in template.')) {
                onChange(clearResults(contest));
              }
            }}
          >
            Clear all results
          </button>
        </div>
      )}
    </Section>
  );
}
