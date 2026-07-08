import {
  CLASSIFICATIONS,
  CONTEST_LEVELS,
  contestNamePreview,
  withIdentity,
  type Contest,
  type ContestIdentity,
  type SectionCompletion,
} from '../../model/contest';
import { Section } from './Section';
import { CopyButton, SelectField, TextField } from './fields';

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
        <TextField
          label="District / Zone / Area Number"
          placeholder="e.g. 20"
          value={identity.districtNumber}
          onChange={(v) => edit({ districtNumber: v })}
        />
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
