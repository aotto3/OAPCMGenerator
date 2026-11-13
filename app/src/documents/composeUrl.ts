/**
 * Compose-URL builder (PRD #304, slice #308). Pure: turns a draft into the URL
 * that opens it in the CM's chosen email app. Generalizes gmailComposeUrl to
 * Outlook (work or school, i.e. Microsoft 365), Outlook.com, and the device's
 * default mail app (mailto:).
 *
 * Every value is percent-encoded with encodeURIComponent (spaces as %20, never
 * '+', which some clients show literally). A mailto: link has a practical
 * length limit; past it the builder says "too long" and hands back a shorter
 * link with only To and Subject, so the caller can copy the body to the
 * clipboard instead of letting the mail app silently cut the message off.
 */
import { gmailComposeUrl } from './emailTemplates';

export const MAIL_APPS = ['gmail', 'outlookWork', 'outlookCom', 'mailto'] as const;
export type MailApp = (typeof MAIL_APPS)[number];

/** Picker labels (what the setting reads). */
export const MAIL_APP_LABELS: Record<MailApp, string> = {
  gmail: 'Gmail',
  outlookWork: 'Outlook (work or school)',
  outlookCom: 'Outlook.com',
  mailto: 'Default mail app',
};

/** Short names for button labels: "Open in Gmail", "Open in Outlook", "Open in Mail". */
export const MAIL_APP_SHORT: Record<MailApp, string> = {
  gmail: 'Gmail',
  outlookWork: 'Outlook',
  outlookCom: 'Outlook.com',
  mailto: 'your mail app',
};

export function isMailApp(value: unknown): value is MailApp {
  return typeof value === 'string' && (MAIL_APPS as readonly string[]).includes(value);
}

export interface ComposeDraft {
  to: string[];
  subject: string;
  body: string;
}

/**
 * The longest mailto: link we hand to the OS. Windows and several mail clients
 * truncate or refuse links much past ~2000 characters.
 */
export const MAILTO_MAX_LENGTH = 2000;

export type ComposeTarget =
  /** Open this URL; the whole draft is in it. */
  | { kind: 'open'; url: string }
  /** mailto only: the full draft is too long. `url` carries To and Subject; copy the body. */
  | { kind: 'tooLong'; url: string };

const enc = encodeURIComponent;

function outlookUrl(base: string, draft: ComposeDraft): string {
  return `${base}?to=${enc(draft.to.join(','))}&subject=${enc(draft.subject)}&body=${enc(draft.body)}`;
}

function mailtoUrl(draft: ComposeDraft, withBody: boolean): string {
  // Addresses are encoded one by one so the separating commas stay literal.
  const to = draft.to.map(enc).join(',');
  const params = [`subject=${enc(draft.subject)}`];
  if (withBody) params.push(`body=${enc(draft.body)}`);
  return `mailto:${to}?${params.join('&')}`;
}

/** Where a draft opens in `app`. */
export function composeTarget(app: MailApp, draft: ComposeDraft): ComposeTarget {
  switch (app) {
    case 'gmail':
      return { kind: 'open', url: gmailComposeUrl(draft) };
    case 'outlookWork':
      return { kind: 'open', url: outlookUrl('https://outlook.office.com/mail/deeplink/compose', draft) };
    case 'outlookCom':
      return { kind: 'open', url: outlookUrl('https://outlook.live.com/mail/0/deeplink/compose', draft) };
    case 'mailto': {
      const full = mailtoUrl(draft, true);
      return full.length <= MAILTO_MAX_LENGTH ? { kind: 'open', url: full } : { kind: 'tooLong', url: mailtoUrl(draft, false) };
    }
    default: {
      const unreached: never = app;
      return unreached;
    }
  }
}
