import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMailer, magicLinkMail, MAILERSEND_ENDPOINT, type OutgoingMail } from '../src/mailer';
import { buildSubmissionNotices } from '../src/questionnaireEmail';

interface Captured {
  url: string;
  init: RequestInit;
}

/** A fetch that records each request and answers with `status`. */
function recordingFetch(status = 202, body = '') {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const CONFIG = { apiKey: 'mlsn.test-key', fromEmail: 'signin@allenotto.com', fromName: 'OAP Contest Manager' };

function sentBody(c: Captured): unknown {
  return JSON.parse(String(c.init.body));
}

describe('magicLinkMail', () => {
  it('matches the content the old magic-link sender produced', () => {
    const url = 'https://oapmanager.allenotto.com/api/auth/magic-link/verify?token=abc&callbackURL=%2F';
    // Copied verbatim from the removed email.ts renderText/renderHtml and subject.
    const oldText = [
      'Sign in to OAP Contest Manager',
      '',
      'Click the link below to sign in. It expires shortly and can be used once.',
      '',
      url,
      '',
      "If you didn't request this, you can ignore this email.",
    ].join('\n');
    const oldHtml =
      '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px">' +
      '<h2 style="margin:0 0 12px">Sign in to OAP Contest Manager</h2>' +
      '<p>Click the button below to sign in. It expires shortly and can be used once.</p>' +
      `<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#1a5276;` +
      'color:#fff;text-decoration:none;border-radius:6px">Sign in</a></p>' +
      `<p style="color:#555;font-size:13px">Or paste this link into your browser:<br>${url}</p>` +
      '<p style="color:#888;font-size:12px">If you didn\'t request this, you can ignore this email.</p>' +
      '</div>';

    expect(magicLinkMail({ email: 'cm@example.org', url })).toEqual({
      to: 'cm@example.org',
      subject: 'Your OAP Contest Manager sign-in link',
      text: oldText,
      html: oldHtml,
    });
  });
});

describe('createMailer with an API key', () => {
  it('sends a magic-link mail as the exact MailerSend request the old sender made', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const mail = magicLinkMail({ email: 'cm@example.org', url: 'https://x.test/verify?token=t' });
    await createMailer({ ...CONFIG, fetchImpl }).send(mail);

    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.url).toBe('https://api.mailersend.com/v1/email');
    expect(c.url).toBe(MAILERSEND_ENDPOINT);
    expect(c.init.method).toBe('POST');
    expect(c.init.headers).toEqual({
      Authorization: 'Bearer mlsn.test-key',
      'Content-Type': 'application/json',
    });
    // No reply_to on the sign-in email, as before.
    expect(sentBody(c)).toEqual({
      from: { email: 'signin@allenotto.com', name: 'OAP Contest Manager' },
      to: [{ email: 'cm@example.org' }],
      subject: 'Your OAP Contest Manager sign-in link',
      text: mail.text,
      html: mail.html,
    });
  });

  it('sends a questionnaire notice with the judge as reply-to', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const [notice] = buildSubmissionNotices({
      judgeName: 'Jane Judge',
      judgeEmail: 'jane@x.org',
      contests: [
        { id: 'c1', title: 'District 12-3A', level: 'District', date: '2027-03-04', host: 'Hosted HS', cmEmail: 'CM@Example.org' },
      ],
      answers: {
        contests: { c1: { hotelBefore: true, hotelAfter: false, requestingFlight: false, needsPower: true } },
        cellPhone: '555-0100',
        mailingAddress: '',
        dietary: '',
        bio: '',
        notes: '',
      },
      isUpdate: false,
      fallbackEmail: undefined,
    });
    await createMailer({ ...CONFIG, fetchImpl }).send(notice);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.mailersend.com/v1/email');
    expect(calls[0].init.headers).toEqual({
      Authorization: 'Bearer mlsn.test-key',
      'Content-Type': 'application/json',
    });
    expect(sentBody(calls[0])).toEqual({
      from: { email: 'signin@allenotto.com', name: 'OAP Contest Manager' },
      to: [{ email: 'cm@example.org' }],
      reply_to: { email: 'jane@x.org' },
      subject: 'Judge questionnaire: Jane Judge',
      text: notice.text,
      html: notice.html,
    });
  });

  it('omits html when the mail has none', async () => {
    const { calls, fetchImpl } = recordingFetch();
    await createMailer({ ...CONFIG, fetchImpl }).send({ to: 'a@b.test', subject: 'S', text: 'T' });
    expect(sentBody(calls[0])).toEqual({
      from: { email: 'signin@allenotto.com', name: 'OAP Contest Manager' },
      to: [{ email: 'a@b.test' }],
      subject: 'S',
      text: 'T',
    });
  });

  it('throws with the status and response body on a non-2xx answer', async () => {
    const { fetchImpl } = recordingFetch(422, '{"message":"The from.email domain must be verified"}');
    const mailer = createMailer({ ...CONFIG, fetchImpl });
    await expect(mailer.send({ to: 'a@b.test', subject: 'S', text: 'T' })).rejects.toThrow(
      'MailerSend send failed (422): {"message":"The from.email domain must be verified"}',
    );
  });
});

describe('createMailer dev fallback', () => {
  const mail: OutgoingMail = magicLinkMail({ email: 'cm@example.org', url: 'http://localhost:8080/verify?token=t' });

  for (const [label, cfg] of [
    ['no API key', { apiKey: '', fromEmail: 'signin@allenotto.com' }],
    ['no From email', { apiKey: 'mlsn.test-key', fromEmail: '' }],
  ] as const) {
    it(`logs instead of sending with ${label}`, async () => {
      const { calls, fetchImpl } = recordingFetch();
      const lines: string[] = [];
      await createMailer({ ...cfg, fromName: 'OAP Contest Manager', fetchImpl, log: (l) => lines.push(l) }).send(mail);

      expect(calls).toHaveLength(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('[dev] email to cm@example.org: Your OAP Contest Manager sign-in link');
      // The link itself is logged, so dev sign-in works without a provider.
      expect(lines[0]).toContain('http://localhost:8080/verify?token=t');
    });
  }
});

describe('one MailerSend caller', () => {
  it('only mailer.ts in server/src references the MailerSend API', () => {
    const dir = join(__dirname, '..', 'src');
    const callers = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('api.mailersend.com'));
    expect(callers).toEqual(['mailer.ts']);
  });
});
