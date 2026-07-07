/**
 * Magic-link email delivery via MailerSend. Transactional sign-in mail;
 * deliverability depends on the sending domain (allenotto.com) being verified in
 * MailerSend with the SPF/DKIM/Return-Path records it provides (see README).
 * MailerSend is used instead of an MX-record provider because the domain's DNS
 * is on Wix, which only supports TXT/CNAME records — which is all MailerSend
 * needs.
 *
 * We call MailerSend's REST API directly with fetch (global on Node 20+) so the
 * server takes on no extra SDK dependency.
 *
 * When MAILERSEND_API_KEY / MAGIC_LINK_FROM_EMAIL are unset (local dev), we log
 * the link to the console instead of sending, so sign-in can be exercised end to
 * end without a real email provider or any secret.
 */
import { optionalEnv } from './env';

const MAILERSEND_ENDPOINT = 'https://api.mailersend.com/v1/email';

export interface MagicLinkMessage {
  email: string;
  url: string;
}

export type MagicLinkSender = (message: MagicLinkMessage) => Promise<void>;

function renderText(url: string): string {
  return [
    'Sign in to OAP Contest Manager',
    '',
    'Click the link below to sign in. It expires shortly and can be used once.',
    '',
    url,
    '',
    "If you didn't request this, you can ignore this email.",
  ].join('\n');
}

function renderHtml(url: string): string {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px">',
    '<h2 style="margin:0 0 12px">Sign in to OAP Contest Manager</h2>',
    '<p>Click the button below to sign in. It expires shortly and can be used once.</p>',
    `<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#1a5276;`,
    'color:#fff;text-decoration:none;border-radius:6px">Sign in</a></p>',
    `<p style="color:#555;font-size:13px">Or paste this link into your browser:<br>${url}</p>`,
    '<p style="color:#888;font-size:12px">If you didn\'t request this, you can ignore this email.</p>',
    '</div>',
  ].join('');
}

/**
 * Builds the sender used by Better Auth's magic-link plugin. Reads config from
 * the environment so the auth instance stays declarative.
 */
export function makeMagicLinkSender(): MagicLinkSender {
  const apiKey = optionalEnv('MAILERSEND_API_KEY');
  const fromEmail = optionalEnv('MAGIC_LINK_FROM_EMAIL');
  const fromName = optionalEnv('MAGIC_LINK_FROM_NAME', 'OAP Contest Manager');

  if (!apiKey || !fromEmail) {
    return async ({ email, url }) => {
      // eslint-disable-next-line no-console
      console.log(`[dev] magic-link for ${email}: ${url}`);
    };
  }

  return async ({ email, url }) => {
    const res = await fetch(MAILERSEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { email: fromEmail, name: fromName },
        to: [{ email }],
        subject: 'Your OAP Contest Manager sign-in link',
        text: renderText(url),
        html: renderHtml(url),
      }),
    });
    // MailerSend returns 202 Accepted on success.
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`MailerSend send failed (${res.status}): ${detail}`);
    }
  };
}
