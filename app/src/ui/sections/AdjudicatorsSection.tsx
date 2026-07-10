import {
  HOTEL_NIGHTS_OPTIONS,
  adjudicatorMilestoneStatus,
  setAdjudicatorMilestone,
  withAdjudicator,
  type Adjudicator,
  type AdjudicatorMilestoneKey,
  type Contest,
  type SectionCompletion,
} from '../../model/contest';
import { Section } from './Section';
import { SelectField, TextAreaField, TextField } from './fields';

export function AdjudicatorsSection({
  contest,
  completion,
  onChange,
  defaultOpen,
}: {
  contest: Contest;
  completion: SectionCompletion;
  onChange: (next: Contest) => void;
  defaultOpen?: boolean;
}) {
  // Like v12, judges beyond numJudges keep their data but are hidden.
  const active = contest.adjudicators.slice(0, contest.details.numJudges);

  return (
    <Section title="⚖️ Judges" badge="After Contracting" completion={completion} defaultOpen={defaultOpen}>
      <p className="note-box">
        Mailing addresses are shared with directors for script submission. Include full address with
        city and ZIP. The contracting checklist tracks paperwork — it never counts toward section
        completion.
      </p>
      {active.map((judge, i) => (
        <JudgeFields
          key={i}
          index={i}
          judge={judge}
          edit={(patch) => onChange(withAdjudicator(contest, i, patch))}
          // Checking stamps today's date (UI supplies `now`); unchecking clears it.
          setMilestone={(key, done) =>
            onChange(setAdjudicatorMilestone(contest, i, key, done, new Date().toISOString()))
          }
        />
      ))}
    </Section>
  );
}

function JudgeFields({
  index,
  judge,
  edit,
  setMilestone,
}: {
  index: number;
  judge: Adjudicator;
  edit: (patch: Partial<Adjudicator>) => void;
  setMilestone: (key: AdjudicatorMilestoneKey, done: boolean) => void;
}) {
  const label = `Judge ${index + 1}`;
  return (
    <div className="judge-block">
      <div className="field-grid">
        <TextField
          label={`${label} — Full Name`}
          placeholder="First Last"
          value={judge.name}
          onChange={(v) => edit({ name: v })}
        />
        <TextField
          label={`${label} — Mailing Address`}
          placeholder="123 Main St, City TX 00000"
          value={judge.mailingAddress}
          onChange={(v) => edit({ mailingAddress: v })}
        />
      </div>
      <div className="judge-extras">
        <label className="check-option">
          <input
            type="checkbox"
            checked={judge.needsPower}
            onChange={(e) => edit({ needsPower: e.target.checked })}
          />
          ⚡ Needs power at table
        </label>
        <label className="check-option">
          <input
            type="checkbox"
            checked={judge.needsHotel}
            onChange={(e) => edit({ needsHotel: e.target.checked })}
          />
          🏨 Needs a hotel
        </label>
        {judge.needsHotel && (
          <SelectField
            label="Hotel Nights"
            value={judge.hotelNights}
            options={HOTEL_NIGHTS_OPTIONS}
            optionLabel={(nights) => `${nights} night${nights === 1 ? '' : 's'}`}
            onChange={(v) => edit({ hotelNights: v })}
          />
        )}
        <TextField
          label="Dietary / Other Requests"
          placeholder="e.g. vegetarian, no shellfish"
          value={judge.dietary}
          onChange={(v) => edit({ dietary: v })}
        />
        <TextAreaField
          label="Bio (optional — printed on the Audience Program)"
          wide
          placeholder="A short adjudicator bio for the printed program. Leave blank to omit."
          value={judge.bio}
          onChange={(v) => edit({ bio: v })}
        />
      </div>
      <div className="judge-milestones">
        <span className="milestone-heading">Contracting checklist</span>
        {adjudicatorMilestoneStatus(judge).map((m) => (
          <div key={m.key} className="milestone-row">
            <label className="check-option">
              <input
                type="checkbox"
                checked={m.done}
                onChange={(e) => setMilestone(m.key, e.target.checked)}
              />
              {m.label}
            </label>
            {m.done && (
              <input
                type="date"
                className="milestone-date"
                value={m.date}
                aria-label={`${m.label} date`}
                // Backdate/correct the stamped date; clearing it unchecks the milestone.
                onChange={(e) => edit({ [m.key]: e.target.value } as Partial<Adjudicator>)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
