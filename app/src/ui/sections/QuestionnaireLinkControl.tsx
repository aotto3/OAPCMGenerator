/**
 * The CM's standing judge questionnaire link (PRD #252), shown in the Judges pane.
 * One link per account covers every upcoming contest, so the same link appears in
 * every contest. Copy puts it on the clipboard; Reset issues a new link and kills
 * the old one (after a confirm). Needs the network: offline it says so. Below the
 * link it shows when the judge roster was last published, or why it failed (#275).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createQuestionnaireClient, questionnaireUrl } from '../../questionnaire/questionnaireClient';
import type { RosterPublishStatus } from '../../questionnaire/rosterPublisher';
import { getRosterPublishStatus, subscribeRosterPublishStatus } from '../../storage/browserSync';

const client = createQuestionnaireClient();

export function QuestionnaireLinkControl() {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState('');
  const publish = useSyncExternalStore(subscribeRosterPublishStatus, getRosterPublishStatus);

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
      <PublishStatusLine status={publish} />
    </div>
  );
}

/** "3:42 PM" today, "Mar 3, 3:42 PM" otherwise, in the device's locale. */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function PublishStatusLine({ status }: { status: RosterPublishStatus }) {
  if (status.kind === 'idle') return null;
  if (status.kind === 'published') {
    return <p className="hint">Judge list published {fmtWhen(status.at)}.</p>;
  }
  return (
    <p className="hint" role="alert">
      Couldn't publish the judge list ({status.reason}). Judges may not find their newest contests yet; it will try
      again at the next sync.
    </p>
  );
}
