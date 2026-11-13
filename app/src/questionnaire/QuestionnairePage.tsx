/**
 * The public judge questionnaire page (PRD #252), reached at /q/<token> with no
 * sign-in. The judge sees only an email box until their email matches a judge in
 * the CM's upcoming contests; then the questionnaire opens: per-contest questions
 * (hotel nights, flying; a back-to-back Zone pair is asked about as one) and
 * general questions, pre-filled from their last submission. Submitting stores the
 * answers for the CM's app to apply; the judge can come back and update them.
 * A link the CM has reset says so up front, so a judge holding the old one asks
 * for the new link instead of thinking they are not on file.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { fmtDate } from '../documents/format';
import { ANSWER_LIMITS } from './limits';
import { createQuestionnaireClient, type JudgeLookup, type LookupResult } from './questionnaireClient';
import type { RosterContest } from './roster';
import {
  blankAnswers,
  contestPower,
  groupContestIds,
  groupContests,
  readGroup,
  shiftDays,
  writeGroup,
  type ContestGroup,
  type GroupAnswers,
  type SubmissionAnswers,
} from './submission';

const client = createQuestionnaireClient();

const LOOKUP_MESSAGES: Record<Exclude<LookupResult['kind'], 'found'>, string> = {
  not_found:
    "We couldn't find any upcoming contests for that email. Check for typos, or contact the contest manager who invited you.",
  rate_limited: 'Too many tries. Please wait a few minutes and try again.',
  error: 'Something went wrong. Check your connection and try again.',
};

export function QuestionnairePage({ token }: { token: string }) {
  const [email, setEmail] = useState('');
  // Honeypot: hidden from people; bots that fill every field get a silent miss.
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [judge, setJudge] = useState<JudgeLookup | null>(null);
  const [linkInactive, setLinkInactive] = useState(false);

  useEffect(() => {
    let live = true;
    void client.linkStatus(token).then((status) => {
      if (live && status === 'inactive') setLinkInactive(true);
    });
    return () => {
      live = false;
    };
  }, [token]);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    if (busy || email.trim() === '') return;
    setBusy(true);
    setMessage('');
    const result = await client.lookup(token, email, website);
    setBusy(false);
    if (result.kind === 'found') setJudge(result.judge);
    else setMessage(LOOKUP_MESSAGES[result.kind]);
  }

  return (
    <main className="page questionnaire">
      <header className="page-header">
        <h1>Adjudicator Questionnaire</h1>
      </header>
      {linkInactive ? (
        <div className="questionnaire-lookup" role="alert">
          <p>
            <strong>This questionnaire link is no longer active.</strong>
          </p>
          <p>
            Your contest manager has replaced it with a new link. Please ask them for the current one; your
            information has not been lost.
          </p>
        </div>
      ) : judge ? (
        <QuestionnaireForm token={token} email={email} website={website} judge={judge} />
      ) : (
        <form className="questionnaire-lookup" onSubmit={(e) => void lookup(e)} noValidate>
          <p>Enter the email address your contest manager has on file for you.</p>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div className="visually-hidden" aria-hidden="true">
            <label>
              Website
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>
          <button type="submit" className="btn-primary" disabled={busy || email.trim() === ''}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          {message && (
            <p className="questionnaire-message" role="alert">
              {message}
            </p>
          )}
        </form>
      )}
    </main>
  );
}

/** Starting answers: the last submission for contests still listed, blanks for the rest. */
function initialAnswers(judge: JudgeLookup): SubmissionAnswers {
  const ids = judge.contests.map((c) => c.id);
  const blank = blankAnswers(ids);
  const last = judge.lastSubmission;
  if (!last) return blank;
  // Older submissions held one power answer for every contest; carry it into each.
  const { needsPower: _legacyPower, ...rest } = last;
  return {
    ...blank,
    ...rest,
    contests: Object.fromEntries(
      ids.map((id) => {
        const saved = last.contests[id];
        return [id, saved ? { ...saved, needsPower: contestPower(saved, last) } : blank.contests[id]];
      }),
    ),
  };
}

const SUBMIT_MESSAGES = {
  not_found: "We couldn't find your contests anymore. Please contact your contest manager.",
  rate_limited: 'Too many tries. Please wait a few minutes and try again.',
  invalid: 'Something in the form was too long or invalid. Please shorten long answers and try again.',
  error: 'Something went wrong. Check your connection and try again.',
} as const;

function QuestionnaireForm({
  token,
  email,
  website,
  judge,
}: {
  token: string;
  email: string;
  website: string;
  judge: JudgeLookup;
}) {
  const groups = groupContests(judge.contests);
  const [answers, setAnswers] = useState<SubmissionAnswers>(() => initialAnswers(judge));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<SubmissionAnswers>) => setAnswers((a) => ({ ...a, ...patch }));
  const setGroup = (group: ContestGroup, patch: Partial<GroupAnswers>) =>
    setAnswers((a) => ({
      ...a,
      contests: { ...a.contests, ...writeGroup(group, { ...readGroup(group, a.contests), ...patch }) },
    }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    const result = await client.submit(token, email, website, answers);
    setBusy(false);
    if (result.kind === 'saved') {
      setSaved(true);
      window.scrollTo(0, 0);
    } else {
      setMessage(SUBMIT_MESSAGES[result.kind]);
    }
  }

  if (saved) {
    return (
      <section className="questionnaire-done" role="status">
        <h2>Thank you{judge.judgeName ? `, ${judge.judgeName}` : ''}!</h2>
        <p>Your answers were sent to your contest manager.</p>
        <p className="muted">You can come back to this link any time to update them.</p>
        <button type="button" className="btn-ghost" onClick={() => setSaved(false)}>
          Edit my answers
        </button>
      </section>
    );
  }

  return (
    <form className="questionnaire-form" onSubmit={(e) => void submit(e)}>
      <p>
        {judge.judgeName ? `Hi, ${judge.judgeName}. ` : ''}You're scheduled to adjudicate the contests below. Please
        tell us a little about yourself, then answer for each contest.
      </p>

      <fieldset className="questionnaire-card">
        <legend>About you</legend>
        {judge.judgeName && (
          <p className="hint">
            Name on file: <strong>{judge.judgeName}</strong>. If it's wrong, contact your contest manager.
          </p>
        )}
        <Field label="Cell number">
          <input
            type="tel"
            autoComplete="tel"
            maxLength={ANSWER_LIMITS.cellPhone}
            value={answers.cellPhone}
            onChange={(e) => set({ cellPhone: e.target.value })}
          />
        </Field>
        <Field label="Mailing address (scripts will be sent here)">
          <textarea
            autoComplete="street-address"
            maxLength={ANSWER_LIMITS.mailingAddress}
            rows={2}
            value={answers.mailingAddress}
            onChange={(e) => set({ mailingAddress: e.target.value })}
          />
        </Field>
        <Field label="Any dietary preferences or restrictions?">
          <input maxLength={ANSWER_LIMITS.dietary} value={answers.dietary} onChange={(e) => set({ dietary: e.target.value })} />
        </Field>
        <Field label="Short bio (optional; if none provided, your TTAO summary may be used)">
          <textarea maxLength={ANSWER_LIMITS.bio} rows={4} value={answers.bio} onChange={(e) => set({ bio: e.target.value })} />
        </Field>
        <Field label="What else would you like me to know to make the contest easy for you?">
          <textarea maxLength={ANSWER_LIMITS.notes} rows={3} value={answers.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </fieldset>

      {groups.map((group) => (
        <ContestGroupCard
          key={groupContestIds(group).join('+')}
          group={group}
          answers={readGroup(group, answers.contests)}
          onChange={(patch) => setGroup(group, patch)}
        />
      ))}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Sending…' : judge.lastSubmission ? 'Update my answers' : 'Send my answers'}
      </button>
      {message && (
        <p className="questionnaire-message" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** "Wednesday, March 3, 2027" for the night of the day before/of `iso`; '' when undated. */
function nightOf(iso: string, offsetDays: number): string {
  return iso ? fmtDate(shiftDays(iso, offsetDays)) : '';
}

function withDate(label: string, date: string): string {
  return date ? `${label} (${date})` : label;
}

function ContestLine({ contest, showTitle = true }: { contest: RosterContest; showTitle?: boolean }) {
  return (
    <div className="questionnaire-contest-line">
      {showTitle && <strong>{contest.title}</strong>}
      <span>{[fmtDate(contest.date) || 'Date to be announced', contest.host].filter(Boolean).join(' · ')}</span>
      <span className="hint">
        Doesn't look right? Contact{' '}
        {contest.cmEmail ? <a href={`mailto:${contest.cmEmail}`}>{contest.cmEmail}</a> : 'the contest manager who invited you'}.
      </span>
    </div>
  );
}

function ContestGroupCard({
  group,
  answers,
  onChange,
}: {
  group: ContestGroup;
  answers: GroupAnswers;
  onChange: (patch: Partial<GroupAnswers>) => void;
}) {
  const first = group.kind === 'single' ? group.contest : group.first;
  const last = group.kind === 'single' ? group.contest : group.second;
  const nights: { key: 'before' | 'between' | 'after'; label: string }[] = [
    { key: 'before', label: withDate('The night before', nightOf(first.date, -1)) },
    ...(group.kind === 'zonePair'
      ? [{ key: 'between' as const, label: withDate('The night between the two zones', nightOf(first.date, 0)) }]
      : []),
    { key: 'after', label: withDate('The night after', nightOf(last.date, 0)) },
  ];
  return (
    <fieldset className="questionnaire-card">
      <legend>{group.kind === 'zonePair' ? 'Zone contests (back to back)' : first.title}</legend>
      <ContestLine contest={first} showTitle={group.kind === 'zonePair'} />
      {group.kind === 'zonePair' && <ContestLine contest={group.second} />}
      <p className="questionnaire-question">If you're coming from out of town, which nights will you need a hotel?</p>
      {nights.map((n) => (
        <label key={n.key} className="check-option">
          <input type="checkbox" checked={answers[n.key]} onChange={(e) => onChange({ [n.key]: e.target.checked })} />
          {n.label}
        </label>
      ))}
      <p className="questionnaire-question">Are you requesting to fly to {group.kind === 'zonePair' ? 'these contests' : 'this contest'}?</p>
      <label className="check-option">
        <input
          type="checkbox"
          checked={answers.requestingFlight}
          onChange={(e) => onChange({ requestingFlight: e.target.checked })}
        />
        Yes. I understand I cannot make flight arrangements until it is approved.
      </label>
      <p className="questionnaire-question">Will you need power at your judging table?</p>
      <label className="check-option">
        <input type="checkbox" checked={answers.needsPower} onChange={(e) => onChange({ needsPower: e.target.checked })} />
        I'll need an electrical outlet for a computer at my judging table
      </label>
    </fieldset>
  );
}
