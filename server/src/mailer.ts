/**
 * The one mail sender (RFC #270, slice #272). Every email the server sends (the
 * magic sign-in link and the judge questionnaire CM notice) goes through
 * `Mailer.send`; this is the only module that calls the MailerSend API.
 *
 * MailerSend is used instead of an MX-record provider because the sending
 * domain's DNS (allenotto.com) is on Wix, which only supports TXT/CNAME records,
 * which is all MailerSend needs (see README). We call its REST API with fetch, so
 * there is no SDK dependency.
 *
 * The mailer owns the transport, the From address and the dev fallback.
 * Templates are pure builders that return `OutgoingMail`: `magicLinkMail` here,
 * `buildSubmissionNotices` in `questionnaireEmail.ts`.
 *
 * With no API key or no From email (local dev), mail is logged to the console
 * instead of sent, text body included, so a magic link can be followed end to
 * end without a provider or any secret.
 */
import { optionalEnv } from './env';

export const MAILERSEND_ENDPOINT = 'https://api.mailersend.com/v1/email';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

export interface MailerConfig {
  apiKey?: string;
  fromEmail: string;
  fromName: string;
  fetchImpl?: typeof fetch;
  /** Where the dev fallback writes; defaults to console.log. */
  log?: (line: string) => void;
}

export function createMailer(cfg: MailerConfig): Mailer {
  const { apiKey, fromEmail, fromName } = cfg;

  if (!apiKey || !fromEmail) {
    // eslint-disable-next-line no-console
    const log = cfg.log ?? ((line: string) => console.log(line));
    return {
      async send(mail) {
        log(`[dev] email to ${mail.to}: ${mail.subject}\n${mail.text}`);
      },
    };
  }

  const fetchImpl = cfg.fetchImpl ?? fetch;
  return {
    async send({ to, replyTo, subject, text, html }) {
      const res = await fetchImpl(MAILERSEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { email: fromEmail, name: fromName },
          to: [{ email: to }],
          ...(replyTo ? { reply_to: { email: replyTo } } : {}),
          subject,
          text,
          ...(html !== undefined ? { html } : {}),
        }),
      });
      // MailerSend returns 202 Accepted on success.
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`MailerSend send failed (${res.status}): ${detail}`);
      }
    },
  };
}

/**
 * The production mailer, configured from the environment. The variable names
 * predate the questionnaire notice, so the From address for every email is
 * still MAGIC_LINK_FROM_EMAIL / MAGIC_LINK_FROM_NAME.
 */
export function mailerFromEnv(): Mailer {
  return createMailer({
    apiKey: optionalEnv('MAILERSEND_API_KEY'),
    fromEmail: optionalEnv('MAGIC_LINK_FROM_EMAIL'),
    fromName: optionalEnv('MAGIC_LINK_FROM_NAME', 'OAP Contest Manager'),
  });
}

/** The sign-in email Better Auth's magic-link plugin sends. Pure. */
export function magicLinkMail(input: { email: string; url: string }): OutgoingMail {
  const { email, url } = input;
  const text = [
    'Sign in to OAP Contest Manager',
    '',
    'Click the link below to sign in. It expires shortly and can be used once.',
    '',
    url,
    '',
    "If you didn't request this, you can ignore this email.",
  ].join('\n');
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px">',
    '<h2 style="margin:0 0 12px">Sign in to OAP Contest Manager</h2>',
    '<p>Click the button below to sign in. It expires shortly and can be used once.</p>',
    `<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#1a5276;`,
    'color:#fff;text-decoration:none;border-radius:6px">Sign in</a></p>',
    `<p style="color:#555;font-size:13px">Or paste this link into your browser:<br>${url}</p>`,
    '<p style="color:#888;font-size:12px">If you didn\'t request this, you can ignore this email.</p>',
    '</div>',
  ].join('');
  return { to: email, subject: 'Your OAP Contest Manager sign-in link', text, html };
}
