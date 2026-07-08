import {
  HOTEL_NIGHTS_OPTIONS,
  withAdjudicator,
  type Adjudicator,
  type Contest,
  type SectionCompletion,
} from '../../model/contest';
import { Section } from './Section';
import { SelectField, TextField } from './fields';

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
    <Section title="⚖️ Adjudicators" badge="After Contracting" completion={completion} defaultOpen={defaultOpen}>
      <p className="note-box">
        Mailing addresses are shared with directors for script submission. Include full address with
        city and ZIP.
      </p>
      {active.map((judge, i) => (
        <JudgeFields
          key={i}
          index={i}
          judge={judge}
          edit={(patch) => onChange(withAdjudicator(contest, i, patch))}
        />
      ))}
    </Section>
  );
}

function JudgeFields({
  index,
  judge,
  edit,
}: {
  index: number;
  judge: Adjudicator;
  edit: (patch: Partial<Adjudicator>) => void;
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
      </div>
    </div>
  );
}
