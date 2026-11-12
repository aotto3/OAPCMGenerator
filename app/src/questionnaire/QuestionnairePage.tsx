/**
 * The public judge questionnaire page (PRD #252), reached at /q/<token> with no
 * sign-in. The judge sees only an email box until their email matches a judge in
 * the CM's upcoming contests; then their contests appear, each with that contest's
 * CM contact line. No names or emails are on the page before a match.
 *
 * Slice #254 stops at the lookup; the questions themselves arrive in #255.
 */
import { useState, type FormEvent } from 'react';
import { fmtDate } from '../documents/format';
import { createQuestionnaireClient, type JudgeLookup, type LookupResult } from './questionnaireClient';

const client = createQuestionnaireClient();

const MESSAGES: Record<Exclude<LookupResult['kind'], 'found'>, string> = {
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || email.trim() === '') return;
    setBusy(true);
    setMessage('');
    const result = await client.lookup(token, email, website);
    setBusy(false);
    if (result.kind === 'found') setJudge(result.judge);
    else setMessage(MESSAGES[result.kind]);
  }

  return (
    <main className="page questionnaire">
      <header className="page-header">
        <h1>Adjudicator Questionnaire</h1>
      </header>
      {judge ? (
        <JudgeContests judge={judge} />
      ) : (
        <form className="questionnaire-lookup" onSubmit={(e) => void submit(e)} noValidate>
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

function JudgeContests({ judge }: { judge: JudgeLookup }) {
  return (
    <section>
      <p>
        {judge.judgeName ? `Hi, ${judge.judgeName}. ` : ''}You're scheduled to adjudicate:
      </p>
      <ul className="questionnaire-contests">
        {judge.contests.map((c) => (
          <li key={c.id}>
            <strong>{c.title}</strong>
            <span>{[fmtDate(c.date) || 'Date to be announced', c.host].filter(Boolean).join(' · ')}</span>
            <span className="hint">
              Doesn't look right? Contact{' '}
              {c.cmEmail ? <a href={`mailto:${c.cmEmail}`}>{c.cmEmail}</a> : 'the contest manager who invited you'}.
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">The questions for these contests will appear here soon.</p>
    </section>
  );
}
