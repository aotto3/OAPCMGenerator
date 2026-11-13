import { useState } from 'react';
import {
  MAIL_APPS,
  MAIL_APP_LABELS,
  MAIL_APP_SHORT,
  composeTarget,
  isMailApp,
  type ComposeDraft,
  type MailApp,
} from '../documents/composeUrl';

/**
 * Which email app compose buttons open (PRD #304, #308). A per-device view
 * preference (like the dashboard sort), not contest data: guarded localStorage,
 * defaulting to Gmail so nothing changes for anyone who never picks.
 */
const STORAGE_KEY = 'oap.mailApp';

function loadMailApp(): MailApp {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isMailApp(raw)) return raw;
  } catch {
    /* fall through to the default */
  }
  return 'gmail';
}

export function usePreferredMailApp(): [MailApp, (app: MailApp) => void] {
  const [app, setApp] = useState<MailApp>(loadMailApp);
  const update = (next: MailApp) => {
    setApp(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* best-effort */
    }
  };
  return [app, update];
}

/** "Open in Gmail", "Open in Outlook", "Open in your mail app". */
export function openInLabel(app: MailApp): string {
  return `Open in ${MAIL_APP_SHORT[app]}`;
}

/** The app's short name, for messages like "Attach it in Outlook before sending". */
export function mailAppName(app: MailApp): string {
  return MAIL_APP_SHORT[app];
}

export interface OpenDraftResult {
  /** A web app's new tab was blocked by the browser. */
  blocked: boolean;
  /** mailto only: the draft was too long, so the body was copied for pasting instead. */
  bodyCopied: boolean;
}

/**
 * Opens `draft` in `app`. Call it inside the click handler so the browser treats
 * the new tab as user-initiated. Web apps open a new tab; the default mail app
 * opens through a mailto: link. When a mailto draft is too long, the body goes
 * to the clipboard and the link carries only To and Subject.
 */
export function openDraft(app: MailApp, draft: ComposeDraft): OpenDraftResult {
  const target = composeTarget(app, draft);
  if (app === 'mailto') {
    const bodyCopied = target.kind === 'tooLong';
    if (bodyCopied) void navigator.clipboard?.writeText(draft.body).catch(() => {});
    const a = document.createElement('a');
    a.href = target.url;
    a.click();
    return { blocked: false, bodyCopied };
  }
  const win = window.open(target.url, '_blank');
  if (win) win.opener = null;
  return { blocked: !win, bodyCopied: false };
}

/** The one-line setting: "Open drafts in: [Gmail ▾]". */
export function MailAppPicker({ value, onChange }: { value: MailApp; onChange: (app: MailApp) => void }) {
  return (
    <label className="mail-app-picker">
      Open drafts in{' '}
      <select value={value} onChange={(e) => isMailApp(e.target.value) && onChange(e.target.value)}>
        {MAIL_APPS.map((a) => (
          <option key={a} value={a}>
            {MAIL_APP_LABELS[a]}
          </option>
        ))}
      </select>
    </label>
  );
}
