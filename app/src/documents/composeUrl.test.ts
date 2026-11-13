import { describe, expect, it } from 'vitest';
import { MAIL_APPS, MAILTO_MAX_LENGTH, composeTarget, isMailApp } from './composeUrl';
import { gmailComposeUrl } from './emailTemplates';

const draft = { to: ['a@x.org', 'b@x.org'], subject: 'A & B - Tab', body: 'Line 1\nSchool 1+2,1,2,3,' };

describe('composeTarget', () => {
  it('Gmail is the existing Gmail compose URL', () => {
    expect(composeTarget('gmail', draft)).toEqual({ kind: 'open', url: gmailComposeUrl(draft) });
  });

  it('Outlook (work or school) opens the Microsoft 365 compose deep link with every field', () => {
    const t = composeTarget('outlookWork', draft);
    expect(t.kind).toBe('open');
    const url = new URL(t.url);
    expect(url.origin + url.pathname).toBe('https://outlook.office.com/mail/deeplink/compose');
    expect(url.searchParams.get('to')).toBe('a@x.org,b@x.org');
    expect(url.searchParams.get('subject')).toBe('A & B - Tab');
    expect(url.searchParams.get('body')).toBe('Line 1\nSchool 1+2,1,2,3,');
  });

  it('Outlook.com opens the outlook.live.com compose deep link', () => {
    const url = new URL(composeTarget('outlookCom', draft).url);
    expect(url.origin + url.pathname).toBe('https://outlook.live.com/mail/0/deeplink/compose');
    expect(url.searchParams.get('body')).toBe('Line 1\nSchool 1+2,1,2,3,');
  });

  it('mailto carries To, Subject and Body, with literal commas between addresses', () => {
    const t = composeTarget('mailto', draft);
    expect(t.kind).toBe('open');
    expect(t.url.startsWith('mailto:a%40x.org,b%40x.org?')).toBe(true);
    const params = new URLSearchParams(t.url.split('?')[1]);
    expect(params.get('subject')).toBe('A & B - Tab');
    expect(params.get('body')).toBe('Line 1\nSchool 1+2,1,2,3,');
  });

  it("never encodes spaces as '+'", () => {
    for (const app of MAIL_APPS) {
      const url = composeTarget(app, { to: [], subject: 'two words', body: 'a b' }).url;
      expect(url).toContain('two%20words');
      expect(url).not.toContain('two+words');
    }
  });

  it('a mailto draft past the length limit says tooLong and keeps only To and Subject', () => {
    const long = { ...draft, body: 'x'.repeat(MAILTO_MAX_LENGTH) };
    const t = composeTarget('mailto', long);
    expect(t.kind).toBe('tooLong');
    expect(t.url).toContain('subject=');
    expect(t.url).not.toContain('body=');
  });

  it('a mailto draft right at the limit still opens whole', () => {
    const base = composeTarget('mailto', { ...draft, body: '' }).url.length;
    const fits = { ...draft, body: 'x'.repeat(MAILTO_MAX_LENGTH - base) };
    expect(composeTarget('mailto', fits).kind).toBe('open');
  });

  it('web apps are never tooLong', () => {
    const long = { ...draft, body: 'x'.repeat(10_000) };
    for (const app of ['gmail', 'outlookWork', 'outlookCom'] as const) expect(composeTarget(app, long).kind).toBe('open');
  });
});

describe('isMailApp', () => {
  it('accepts only known apps', () => {
    for (const app of MAIL_APPS) expect(isMailApp(app)).toBe(true);
    for (const bad of ['outlook', '', null, 3]) expect(isMailApp(bad)).toBe(false);
  });
});
