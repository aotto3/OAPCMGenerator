/**
 * The email a CM gets when a judge submits the questionnaire (PRD #252, #256).
 * Pure: builds one message per recipient from the submission; sending is a seam.
 *
 * Recipients are the distinct CM emails of the contests the judge answered for;
 * each CM sees the general answers plus only the contests that list them, so a
 * judge's other assignments aren't shown to a different CM. When no answered
 * contest has a CM email, the account's own sign-in email gets everything.
 * Reply-To is the judge, so the CM can answer them directly.
 */
import { normalizeEmail, type RosterContest, type SubmissionAnswers } from './judgeRoster';

export interface OutgoingMail {
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

export type MailSender = (mail: OutgoingMail) => Promise<void>;

export interface SubmissionNoticeInput {
  judgeName: string;
  judgeEmail: string;
  /** The judge's roster contests, in roster order. */
  contests: RosterContest[];
  answers: SubmissionAnswers;
  /** True when this replaces an earlier submission. */
  isUpdate: boolean;
  /** Used when no answered contest has a CM email. */
  fallbackEmail: string | undefined;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Thursday, March 4, 2027"; '' for a blank or malformed date. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function hotelText(before: boolean, after: boolean): string {
  const nights = [before && 'night before', after && 'night after'].filter(Boolean);
  return nights.length ? nights.join(', ') : 'none';
}

const yesNo = (v: boolean) => (v ? 'yes' : 'no');
const orBlank = (v: string) => v.trim() || '(blank)';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One message per distinct recipient. */
export function buildSubmissionNotices(input: SubmissionNoticeInput): OutgoingMail[] {
  const answered = input.contests.filter((c) => input.answers.contests[c.id]);
  const byRecipient = new Map<string, RosterContest[]>();
  for (const c of answered) {
    const to = normalizeEmail(c.cmEmail);
    if (to === '') continue;
    byRecipient.set(to, [...(byRecipient.get(to) ?? []), c]);
  }
  if (byRecipient.size === 0 && input.fallbackEmail) {
    byRecipient.set(normalizeEmail(input.fallbackEmail), answered);
  }
  return [...byRecipient].map(([to, contests]) => buildOne(input, to, contests));
}

function buildOne(input: SubmissionNoticeInput, to: string, contests: RosterContest[]): OutgoingMail {
  const who = input.judgeName.trim() || input.judgeEmail;
  const a = input.answers;
  const subject = `Judge questionnaire${input.isUpdate ? ' (updated)' : ''}: ${who}`;

  const contestBlocks = contests.map((c) => {
    const ans = a.contests[c.id];
    const date = longDate(c.date);
    return {
      heading: date ? `${c.title} (${date})` : c.title,
      lines: [
        `Hotel: ${hotelText(ans.hotelBefore, ans.hotelAfter)}`,
        `Requesting to fly: ${yesNo(ans.requestingFlight)}`,
      ],
    };
  });
  const about: [string, string][] = [
    ['Cell', orBlank(a.cellPhone)],
    ['Mailing address', orBlank(a.mailingAddress)],
    ['Dietary', orBlank(a.dietary)],
    ['Power at judging table', yesNo(a.needsPower)],
    ['Bio', orBlank(a.bio)],
    ['Anything else', orBlank(a.notes)],
  ];
  const intro = `${who} (${input.judgeEmail}) ${input.isUpdate ? 'updated their' : 'submitted the'} adjudicator questionnaire.`;
  const outro =
    'These answers fill in the Judges pane of each contest the next time OAP Contest Manager syncs. Reply to this email to reach the judge.';

  const text = [
    intro,
    '',
    'CONTESTS',
    ...contestBlocks.flatMap((b) => [b.heading, ...b.lines.map((l) => `  ${l}`), '']),
    'ABOUT THE JUDGE',
    ...about.map(([k, v]) => `${k}: ${v}`),
    '',
    outro,
  ].join('\n');

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px">',
    `<p>${escapeHtml(intro)}</p>`,
    '<h3 style="margin:16px 0 8px">Contests</h3>',
    ...contestBlocks.map(
      (b) =>
        `<p style="margin:0 0 10px"><strong>${escapeHtml(b.heading)}</strong><br>${b.lines
          .map(escapeHtml)
          .join('<br>')}</p>`,
    ),
    '<h3 style="margin:16px 0 8px">About the judge</h3>',
    '<table style="border-collapse:collapse">',
    ...about.map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;vertical-align:top;color:#555">${escapeHtml(k)}</td>` +
        `<td style="padding:2px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`,
    ),
    '</table>',
    `<p style="color:#666;font-size:13px">${escapeHtml(outro)}</p>`,
    '</div>',
  ].join('');

  return { to, replyTo: input.judgeEmail, subject, text, html };
}
