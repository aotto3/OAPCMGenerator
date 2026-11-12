import {
  adjudicatorMilestoneStatus,
  setAdjudicatorMilestone,
  type Adjudicator,
  type AdjudicatorMilestoneKey,
  type Contest,
  type SectionCompletion,
} from '../../model/contest';
import { activeJudgeSlots, setJudge } from '../../model/judgePanel';
import { fmtDateShort } from '../../documents/format';
import { localToday } from '../../questionnaire/rosterPublisher';
import { CopyJudgesControl } from './CopyJudgesControl';
import { QuestionnaireLinkControl } from './QuestionnaireLinkControl';
import { Section } from './Section';
import { TextAreaField, TextField } from './fields';

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
  const active = activeJudgeSlots(contest);

  return (
    <Section title="⚖️ Judges" badge="After Contracting" completion={completion} defaultOpen={defaultOpen}>
      <p className="note-box">
        Mailing addresses are shared with directors for script submission. Include full address with
        city and ZIP. Emails and cell numbers stay with you: they appear only on the Adjudicator Info Sheet, never in a
        document for directors. The contracting checklist tracks paperwork and never counts toward section completion.
      </p>
      <QuestionnaireLinkControl />
      {active.map(({ index: i, judge }) => (
        <JudgeFields
          key={i}
          index={i}
          judge={judge}
          edit={(patch) => onChange(setJudge(contest, i, patch))}
          // Checking stamps today's date (UI supplies `now`); unchecking clears it.
          setMilestone={(key, done) =>
            onChange(setAdjudicatorMilestone(contest, i, key, done, new Date().toISOString()))
          }
        />
      ))}
      {contest.identity.contestLevel === 'Zone' && <CopyJudgesControl contest={contest} />}
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
  const headingId = `judge-${index + 1}-heading`;
  return (
    <section className="judge-block" aria-labelledby={headingId}>
      <h3 id={headingId} className="judge-title">
        Judge {index + 1}
      </h3>
      {judge.questionnaireUpdatedAt && (
        <p className="questionnaire-badge">
          Updated from questionnaire on {fmtDateShort(localToday(new Date(judge.questionnaireUpdatedAt)))}
        </p>
      )}
      <div className="judge-grid">
        <div className="jg-name">
          <TextField label="Full Name" placeholder="First Last" value={judge.name} onChange={(v) => edit({ name: v })} />
        </div>
        <div className="jg-addr">
          <TextField
            label="Mailing Address"
            placeholder="123 Main St, City TX 00000"
            value={judge.mailingAddress}
            onChange={(v) => edit({ mailingAddress: v })}
          />
        </div>
        <div className="jg-email">
          <TextField
            label="Email"
            type="email"
            placeholder="judge@example.com"
            value={judge.email}
            onChange={(v) => edit({ email: v })}
          />
          {judge.name.trim() !== '' && judge.email.trim() === '' && (
            <p className="hint email-hint">Add an email so this judge can use the questionnaire.</p>
          )}
        </div>
        <div className="jg-cell">
          <TextField
            label="Cell Number"
            type="tel"
            placeholder="555-555-5555"
            value={judge.cellPhone}
            onChange={(v) => edit({ cellPhone: v })}
          />
        </div>
        <div className="jg-diet">
          <TextField
            label="Dietary / Other Requests"
            placeholder="e.g. vegetarian, no shellfish"
            value={judge.dietary}
            onChange={(v) => edit({ dietary: v })}
          />
        </div>
        <div className="jg-needs">
          <label className="check-option">
            <input
              type="checkbox"
              checked={judge.needsPower}
              onChange={(e) => edit({ needsPower: e.target.checked })}
            />
            ⚡ Needs power at table
          </label>
          <div className="judge-hotel">
            <label className="check-option">
              <input
                type="checkbox"
                checked={judge.needsHotel}
                onChange={(e) => edit({ needsHotel: e.target.checked })}
              />
              🏨 Needs a hotel
            </label>
            {judge.needsHotel && (
              <div className="judge-hotel-nights" role="group" aria-label="Hotel nights">
                <label className="check-option">
                  <input
                    type="checkbox"
                    checked={judge.hotelNights.before}
                    onChange={(e) => edit({ hotelNights: { ...judge.hotelNights, before: e.target.checked } })}
                  />
                  Night before
                </label>
                <label className="check-option">
                  <input
                    type="checkbox"
                    checked={judge.hotelNights.after}
                    onChange={(e) => edit({ hotelNights: { ...judge.hotelNights, after: e.target.checked } })}
                  />
                  Night after
                </label>
              </div>
            )}
          </div>
          <label className="check-option">
            <input
              type="checkbox"
              checked={judge.requestingFlight}
              onChange={(e) => edit({ requestingFlight: e.target.checked })}
            />
            ✈️ Requesting to fly
          </label>
        </div>
        <div className="jg-bio">
          <TextAreaField
            label="Bio (optional, printed on the Audience Program)"
            placeholder="A short adjudicator bio for the printed program. Leave blank to omit."
            value={judge.bio}
            onChange={(v) => edit({ bio: v })}
          />
        </div>
        <div className="jg-notes">
          <TextAreaField
            label="Judge notes (only you see these)"
            placeholder="Anything else to remember about this judge. Prints on the Adjudicator Info Sheet only."
            value={judge.judgeNotes}
            onChange={(v) => edit({ judgeNotes: v })}
          />
        </div>
        <div className="jg-check judge-milestones">
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
    </section>
  );
}
