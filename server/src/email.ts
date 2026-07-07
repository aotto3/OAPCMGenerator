/**
 * Magic-link email delivery via Resend. Transactional sign-in mail; deliver-
 * ability into locked-down school-district inboxes depends on the sending
 * domain's SPF/DKIM/DMARC being configured in Resend (see README).
 *
 * When RESEND_API_KEY is unset (local dev), we log the link to the console
 * instead of sending, so sign-in can be exercised end to end without a real
 * email provider or any secret.
 */
import { Resend } from 'resend';
import { optionalEnv } from './env';

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
  const apiKey = optionalEnv('RESEND_API_KEY');
  const from = optionalEnv('MAGIC_LINK_FROM', 'OAP Contest Manager <onboarding@resend.dev>');

  if (!apiKey) {
    return async ({ email, url }) => {
      // eslint-disable-next-line no-console
      console.log(`[dev] magic-link for ${email}: ${url}`);
    };
  }

  const resend = new Resend(apiKey);
  return async ({ email, url }) => {
    const { error } = await resend.emails.send({
      from,
      to: email,
      subject: 'Your OAP Contest Manager sign-in link',
      text: renderText(url),
      html: renderHtml(url),
    });
    if (error) {
      throw new Error(`Failed to send magic-link email: ${error.message}`);
    }
  };
}
