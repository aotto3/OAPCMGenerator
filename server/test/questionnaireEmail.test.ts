import { describe, expect, it } from 'vitest';
import { buildSubmissionNotices, longDate, type SubmissionNoticeInput } from '../src/questionnaireEmail';

const contest = (id: string, cmEmail: string, date = '2027-03-04') => ({
  id,
  title: `Contest ${id}`,
  level: 'Zone',
  date,
  host: 'Host HS',
  cmEmail,
});

const input = (patch: Partial<SubmissionNoticeInput> = {}): SubmissionNoticeInput => ({
  judgeName: 'Jane Judge',
  judgeEmail: 'jane@x.org',
  contests: [contest('a', 'cm@x.org'), contest('b', 'CM@x.org ', '2027-03-05')],
  answers: {
    cellPhone: '512-555-0100',
    mailingAddress: '1 Main St\nAustin TX',
    dietary: '',
    bio: 'A bio',
    notes: 'Arriving <late>',
    contests: {
      a: { hotelBefore: true, hotelAfter: true, requestingFlight: false, needsPower: true },
      b: { hotelBefore: false, hotelAfter: false, requestingFlight: true, needsPower: false },
    },
  },
  isUpdate: false,
  fallbackEmail: 'owner@x.org',
  ...patch,
});

describe('buildSubmissionNotices', () => {
  it('sends one message per distinct CM email, replying to the judge', () => {
    const mails = buildSubmissionNotices(input());
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('cm@x.org');
    expect(mails[0].replyTo).toBe('jane@x.org');
    expect(mails[0].subject).toBe('Judge questionnaire: Jane Judge');
  });

  it('lists every answer, per contest and general', () => {
    const { text } = buildSubmissionNotices(input())[0];
    expect(text).toContain('Jane Judge (jane@x.org) submitted the adjudicator questionnaire.');
    expect(text).toContain('Contest a (Thursday, March 4, 2027)\n  Hotel: night before, night after\n  Requesting to fly: no');
    expect(text).toContain('Contest b (Friday, March 5, 2027)\n  Hotel: none\n  Requesting to fly: yes');
    expect(text).toContain('Cell: 512-555-0100');
    expect(text).toContain('Mailing address: 1 Main St\nAustin TX');
    expect(text).toContain('Dietary: (blank)');
    expect(text).toContain('Bio: A bio');
    expect(text).toContain('Anything else: Arriving <late>');
  });

  it('shows each CM only their own contests', () => {
    const mails = buildSubmissionNotices(input({ contests: [contest('a', 'one@x.org'), contest('b', 'two@x.org')] }));
    expect(mails.map((m) => m.to)).toEqual(['one@x.org', 'two@x.org']);
    expect(mails[0].text).toContain('Contest a');
    expect(mails[0].text).not.toContain('Contest b');
    expect(mails[1].text).toContain('Contest b');
  });

  it('falls back to the account email when no answered contest has a CM email', () => {
    const mails = buildSubmissionNotices(input({ contests: [contest('a', ''), contest('b', '  ')] }));
    expect(mails.map((m) => m.to)).toEqual(['owner@x.org']);
    expect(mails[0].text).toContain('Contest a');
    expect(mails[0].text).toContain('Contest b');
  });

  it('sends nothing with no recipient at all', () => {
    expect(buildSubmissionNotices(input({ contests: [contest('a', '')], fallbackEmail: undefined }))).toEqual([]);
  });

  it('skips contests the judge did not answer for', () => {
    const mails = buildSubmissionNotices(
      input({ contests: [contest('a', 'one@x.org'), contest('c', 'three@x.org')] }),
    );
    expect(mails.map((m) => m.to)).toEqual(['one@x.org']);
  });

  it('marks an update', () => {
    const mail = buildSubmissionNotices(input({ isUpdate: true }))[0];
    expect(mail.subject).toBe('Judge questionnaire (updated): Jane Judge');
    expect(mail.text).toContain('updated their adjudicator questionnaire');
  });

  it('escapes judge-typed text in the HTML', () => {
    const { html } = buildSubmissionNotices(input())[0];
    expect(html).toContain('Arriving &lt;late&gt;');
    expect(html).not.toContain('<late>');
  });
});

describe('longDate', () => {
  it('formats ISO dates and blanks anything else', () => {
    expect(longDate('2027-03-04')).toBe('Thursday, March 4, 2027');
    expect(longDate('')).toBe('');
  });
});
