/**
 * The CM's standing judge questionnaire link (PRD #252), shown in the Judges pane.
 * One link per account covers every upcoming contest, so the same link appears in
 * every contest. Copy puts it on the clipboard; Reset issues a new link and kills
 * the old one (after a confirm). Needs the network: offline it says so.
 */
import { useEffect, useState } from 'react';
import { createQuestionnaireClient, questionnaireUrl } from '../../questionnaire/questionnaireClient';

const client = createQuestionnaireClient();

export function QuestionnaireLinkControl() {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let live = true;
    client.getLinkToken().then(
      (t) => live && setToken(t),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const url = token ? questionnaireUrl(window.location.origin, token) : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Copied.');
    } catch {
      setStatus('Copy failed; select the link and copy it.');
    }
  }

  async function reset() {
    const ok = window.confirm(
      'Reset the questionnaire link? The old link stops working right away, and judges will need the new one.',
    );
    if (!ok) return;
    try {
      setToken(await client.resetLinkToken());
      setStatus('New link ready. The old link no longer works.');
    } catch {
      setStatus("Couldn't reset the link. Check your connection and try again.");
    }
  }

  return (
    <div className="questionnaire-link">
      <span className="milestone-heading">Judge questionnaire link</span>
      {failed ? (
        <p className="hint">Connect to the internet to see your questionnaire link.</p>
      ) : !token ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          <p className="hint">
            One link for all your upcoming contests. Judges enter the email you have on file for them.
          </p>
          <div className="questionnaire-link-row">
            <input readOnly value={url} aria-label="Questionnaire link" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn-primary" onClick={() => void copy()}>
              Copy link
            </button>
            <button type="button" className="btn-ghost" onClick={() => void reset()}>
              Reset link
            </button>
          </div>
          {status && (
            <p className="hint" role="status">
              {status}
            </p>
          )}
        </>
      )}
    </div>
  );
}
