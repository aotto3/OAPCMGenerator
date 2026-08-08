import {
  CLASSIFICATIONS,
  CONTEST_LEVELS,
  LEVEL_FIELDS,
  contestNamePreview,
  withIdentity,
  type Contest,
  type ContestIdentity,
  type LevelFieldKey,
  type SectionCompletion,
} from '../../model/contest';
import { Section } from './Section';
import { CopyButton, SelectField, TextField } from './fields';

/** Per-field label + placeholder for the level identifiers, keyed to LEVEL_FIELDS. */
const LEVEL_FIELD_META: Record<LevelFieldKey, { label: string; placeholder: string }> = {
  region: { label: 'Region', placeholder: 'e.g. 2' },
  area: { label: 'Area', placeholder: 'e.g. 1' },
  district: { label: 'District', placeholder: 'e.g. 20' },
  districtSecond: { label: 'Second District', placeholder: 'e.g. 21' },
  zone: { label: 'Zone', placeholder: 'e.g. 3' },
};

/** BiDistrict's `district` box is the pair's FIRST slot — label it so. */
function levelFieldLabel(level: string, key: LevelFieldKey): string {
  if (level === 'BiDistrict' && key === 'district') return 'First District';
  return LEVEL_FIELD_META[key].label;
}

export function IdentitySection({
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
  const { identity } = contest;
  const edit = (patch: Partial<ContestIdentity>) => onChange(withIdentity(contest, patch));

  return (
    <Section title="📋 Contest Identity" badge="Upon Appointment" completion={completion} defaultOpen={defaultOpen}>
      <div className="field-grid">
        <TextField label="Contest Year" value={identity.contestYear} onChange={(v) => edit({ contestYear: v })} />
        <SelectField
          label="Contest Level"
          value={identity.contestLevel}
          options={CONTEST_LEVELS}
          onChange={(v) => edit({ contestLevel: v })}
        />
        <SelectField
          label="Classification"
          value={identity.classification}
          options={CLASSIFICATIONS}
          onChange={(v) => edit({ classification: v })}
        />
        {LEVEL_FIELDS[identity.contestLevel].map((key) => (
          <TextField
            key={key}
            label={levelFieldLabel(identity.contestLevel, key)}
            inputMode="numeric"
            placeholder={LEVEL_FIELD_META[key].placeholder}
            value={identity[key]}
            onChange={(v) => edit({ [key]: v })}
          />
        ))}
        <label className="field">
          Contest Name Preview
          <span className="input-with-button">
            <input readOnly value={contestNamePreview(identity)} />
            <CopyButton getText={() => contestNamePreview(identity)} />
          </span>
        </label>
        <TextField
          label="Host School Name"
          placeholder="e.g. Friendswood High School"
          value={identity.hostSchoolName}
          onChange={(v) => edit({ hostSchoolName: v })}
        />
        <TextField
          label="Venue / Auditorium Name"
          placeholder="e.g. Friendswood PAC"
          value={identity.hostVenueName}
          onChange={(v) => edit({ hostVenueName: v })}
        />
        <TextField
          label="Venue Street Address"
          wide
          placeholder="e.g. 702 Greenbriar Dr. Friendswood, Texas 77546"
          value={identity.hostAddress}
          onChange={(v) => edit({ hostAddress: v })}
        />
      </div>
    </Section>
  );
}
