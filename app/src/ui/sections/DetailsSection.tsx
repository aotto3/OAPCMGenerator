import { useState } from 'react';
import {
  CRITIQUE_FORMATS,
  MAX_JUDGES,
  MAX_SCHOOLS,
  MIN_SCHOOLS,
  REHEARSAL_LENGTH_OPTIONS,
  numSchools,
  rehearsalDay1Count,
  rehearsalDay2Count,
  setNumSchools,
  withDetails,
  withSpeechwire,
  type Contest,
  type ContestDetails,
  type CritiqueFormat,
  type SectionCompletion,
} from '../../model/contest';
import { Section } from './Section';
import { CopyButton, Divider, SelectField, TextField } from './fields';

const CRITIQUE_LABELS: Record<CritiqueFormat, string> = {
  after_each: 'After Each Show',
  after_all: 'After All Shows',
};

const JUDGE_OPTIONS = Array.from({ length: MAX_JUDGES }, (_, i) => i + 1);
const SCHOOL_OPTIONS = Array.from({ length: MAX_SCHOOLS - MIN_SCHOOLS + 1 }, (_, i) => MIN_SCHOOLS + i);

export function DetailsSection({
  contest,
  completion,
  onChange,
}: {
  contest: Contest;
  completion: SectionCompletion;
  onChange: (next: Contest) => void;
}) {
  const { details } = contest;
  const edit = (patch: Partial<ContestDetails>) => onChange(withDetails(contest, patch));
  const [showPassword, setShowPassword] = useState(false);

  const n = numSchools(contest);
  const day1 = rehearsalDay1Count(contest);
  const day2 = rehearsalDay2Count(contest);
  const day1Options = Array.from({ length: n - 1 }, (_, i) => i + 1);

  return (
    <Section title="📅 Contest Details" badge="After Planning Meeting" completion={completion} defaultOpen={false}>
      <Divider>Dates &amp; Times</Divider>
      <div className="field-grid">
        <TextField
          label="Contest Date"
          type="date"
          value={details.contestDate}
          onChange={(v) => edit({ contestDate: v })}
        />
        <TextField
          label="Directors Meeting Time"
          placeholder="e.g. 10:00 AM"
          value={details.directorsMeetingTime}
          onChange={(v) => edit({ directorsMeetingTime: v })}
        />
        <TextField
          label="First Show / Setup Time"
          placeholder="e.g. 11:00 AM"
          value={details.firstShowTime}
          onChange={(v) => edit({ firstShowTime: v })}
        />
      </div>

      <Divider>Competition Format</Divider>
      <div className="field-grid">
        <fieldset className="field radio-field">
          <legend>Critique Format</legend>
          <div className="radio-group">
            {CRITIQUE_FORMATS.map((format) => (
              <label key={format} className="radio-option">
                <input
                  type="radio"
                  name="critique_format"
                  checked={details.critiqueFormat === format}
                  onChange={() => edit({ critiqueFormat: format })}
                />
                {CRITIQUE_LABELS[format]}
              </label>
            ))}
          </div>
        </fieldset>
        <SelectField
          label="Number of Judges"
          value={details.numJudges}
          options={JUDGE_OPTIONS}
          optionLabel={(j) => `${j} Judge${j === 1 ? '' : 's'}`}
          onChange={(v) => edit({ numJudges: v })}
        />
        <SelectField
          label="Number of Schools"
          value={n}
          options={SCHOOL_OPTIONS}
          onChange={(v) => onChange(setNumSchools(contest, v))}
        />
      </div>

      <Divider>Rehearsals</Divider>
      <div className="field-grid">
        <TextField
          label="Rehearsal Date 1"
          type="date"
          value={details.rehearsalDate1}
          onChange={(v) => edit({ rehearsalDate1: v })}
        />
        <TextField
          label="Rehearsal Date 2 (Optional)"
          type="date"
          value={details.rehearsalDate2}
          onChange={(v) => edit({ rehearsalDate2: v })}
        />
        <TextField
          label="Day 1 Start Time"
          placeholder="e.g. 2:00 PM"
          value={details.rehearsalStartTime1}
          onChange={(v) => edit({ rehearsalStartTime1: v })}
        />
        {details.rehearsalDate2 && (
          <>
            <TextField
              label="Day 2 Start Time"
              placeholder="e.g. 2:00 PM"
              value={details.rehearsalStartTime2}
              onChange={(v) => edit({ rehearsalStartTime2: v })}
            />
            <SelectField
              label="Schools on Day 1"
              value={day1}
              options={day1Options}
              optionLabel={(i) => `${i} school${i === 1 ? '' : 's'}`}
              onChange={(v) => edit({ rehearsalDay1Count: v })}
              hint="Day 2 gets the rest"
            />
            <TextField
              label="Schools on Day 2"
              readOnly
              value={`${day2} school${day2 === 1 ? '' : 's'}`}
            />
          </>
        )}
        <SelectField
          label="Rehearsal Slot Length"
          value={details.rehearsalLengthMinutes}
          options={REHEARSAL_LENGTH_OPTIONS}
          optionLabel={(m) => (m === 120 ? '2 hours' : `${m} minutes`)}
          onChange={(v) => edit({ rehearsalLengthMinutes: v })}
          hint="10 min transition added between each slot"
        />
      </div>

      <Divider>Fees &amp; Deadlines</Divider>
      <div className="field-grid">
        <TextField
          label="Entry Fee (per school)"
          placeholder="e.g. 50"
          hint="Leave blank if no entry fee"
          value={details.entryFee}
          onChange={(v) => edit({ entryFee: v })}
        />
        <TextField
          label="Admission Fee"
          placeholder="e.g. 10"
          hint="Leave blank if no admission"
          value={details.admissionFee}
          onChange={(v) => edit({ admissionFee: v })}
        />
        <TextField
          label="Entry System Deadline"
          type="date"
          hint="Auto-set to 10 days before contest"
          value={details.entrySystemDeadline}
          onChange={(v) => edit({ entrySystemDeadline: v })}
        />
        <TextField
          label="Light Cue Deadline — Date"
          type="date"
          value={details.lightCueDeadlineDate}
          onChange={(v) => edit({ lightCueDeadlineDate: v })}
        />
        <TextField
          label="Light Cue Deadline — Time"
          value={details.lightCueDeadlineTime}
          onChange={(v) => edit({ lightCueDeadlineTime: v })}
        />
        {contest.identity.contestLevel === 'BiDistrict' && (
          <TextField
            label="BiDistrict Contest Date"
            type="date"
            hint="Date of the advancing BiDistrict contest"
            value={details.bidcContestDate}
            onChange={(v) => edit({ bidcContestDate: v })}
          />
        )}
      </div>

      <Divider>Speechwire Access</Divider>
      <p className="device-only-note">
        🔒 Stored on this device only — never synced to your account or included in exports.
      </p>
      <div className="field-grid">
        <TextField
          label="Speechwire Username"
          placeholder="e.g. district20-5a"
          value={contest.speechwire.username}
          onChange={(v) => onChange(withSpeechwire(contest, { username: v }))}
        />
        <label className="field">
          Speechwire Password
          <span className="input-with-button">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Provided by state theatre director"
              autoComplete="off"
              value={contest.speechwire.password}
              onChange={(e) => onChange(withSpeechwire(contest, { password: e.target.value }))}
            />
            <button
              type="button"
              className="btn-util"
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
            <CopyButton getText={() => contest.speechwire.password} />
          </span>
        </label>
      </div>
    </Section>
  );
}
