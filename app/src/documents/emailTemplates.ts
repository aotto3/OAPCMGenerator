/**
 * Email draft composer templates — the five routine contest emails, ported from
 * v12's EMAIL_TEMPLATES / generateAdvancingEmail (_Templates/OAP Contest
 * Setup.html, ~lines 1062–1210).
 *
 * PURE MODULE. Each template is a plain function of the Contest record: a
 * contest goes in, a { subject, body } draft comes out — no DOM, no clipboard,
 * mirroring schedule.ts and the .docx builders. The workspace composer
 * (ui/EmailComposer.tsx) is the only place these meet the browser; it renders
 * the draft into editable fields and owns the copy buttons.
 *
 * Behavior spec is v12 EXACTLY. v12 fed the templates a flat `vars` bag read
 * from the DOM (FormState.email); here the same values are read straight off the
 * typed model — contestFullName() for the contest name, fmtDate/fmtDateShort for
 * the human dates, docSchools() for the performance-order show list, and
 * parseTime/fmtTime for the judges' "arrive 20 minutes before the meeting" math.
 * The per-field placeholder fallbacks ('[Venue TBD]', '[TBD]', …) are v12's, so
 * a half-filled contest reads identically to the old tool.
 *
 * The judges template deliberately does NOT list the critique assignment: judges
 * do not learn the critique draw until the last possible moment, so it never
 * belongs in an email sent ahead of contest day (resolves issue #23's deferred
 * "critique in the judges email" clause — decided out).
 */

import { contestFullName, type Contest } from '../model/contest';
import { fmtTime, parseTime } from '../model/schedule';
import { docSchools } from './docVars';
import { fmtDate, fmtDateShort } from './format';

/** A composed email — the shape every template returns. */
export interface EmailDraft {
  subject: string;
  body: string;
}

/** The advancing-schools draft also carries the resolved recipient list. */
export interface AdvancingDraft extends EmailDraft {
  /** Director emails of the checked schools, blanks skipped, in form order. */
  to: string[];
}

/** Identifiers for the four one-click templates (the advancing picker is separate). */
export type EmailTemplateId = 'announcement' | 'deadline' | 'daybefore' | 'judges';

/**
 * Contest Announcement — the "congratulations, here's the contest" email sent
 * once schools qualify. v12 EMAIL_TEMPLATES.announcement.
 */
export function announcementEmail(contest: Contest): EmailDraft {
  const cn = contestFullName(contest.identity) || '[Contest Name]';
  const lv = contest.identity.contestLevel || 'Contest';
  const dt = fmtDate(contest.details.contestDate) || '[Contest Date TBD]';
  const ven = contest.identity.hostVenueName || '[Venue TBD]';
  const adr = contest.identity.hostAddress || '[Address TBD]';
  const dmt = contest.details.directorsMeetingTime || '[TBD]';
  const fst = contest.details.firstShowTime || '[TBD]';
  const edd = fmtDateShort(contest.details.entrySystemDeadline) || '[TBD]';
  const cmn = contest.cmInfo.name || '[CM Name]';
  const cme = contest.cmInfo.email || '[CM Email]';
  const cmp = contest.cmInfo.phone || '';
  return {
    subject: cn + ' — Contest Information',
    body:
      'Dear ' + lv + ' Directors,\n\n' +
      'Congratulations on qualifying for the ' + cn + '! I am looking forward to serving as your Contest Manager.\n\n' +
      'The contest will be held on ' + dt + ' at ' + ven + ', located at ' + adr + '.\n\n' +
      'Directors’ Meeting: ' + dmt + '\n' +
      'First Performance: ' + fst + '\n\n' +
      'Please submit your entries by ' + edd + '.\n\n' +
      'If you have any questions, please contact me at ' + cme + (cmp ? ' or ' + cmp : '') + '.\n\n' +
      'Sincerely,\n' + cmn + '\nContest Manager',
  };
}

/**
 * Entry Deadline Reminder — nudge on the entry and light-cue deadlines. v12
 * EMAIL_TEMPLATES.deadline.
 */
export function deadlineEmail(contest: Contest): EmailDraft {
  const cn = contestFullName(contest.identity) || '[Contest Name]';
  const edd = fmtDateShort(contest.details.entrySystemDeadline) || '[TBD]';
  const lcd = fmtDateShort(contest.details.lightCueDeadlineDate) || '[TBD]';
  const lct = contest.details.lightCueDeadlineTime || '5:00 PM';
  const cmn = contest.cmInfo.name || '[CM Name]';
  const cmp = contest.cmInfo.phone || '';
  return {
    subject: cn + ' — Entry Deadline Reminder',
    body:
      'Dear Directors,\n\n' +
      'This is a reminder of the upcoming deadlines for the ' + cn + ':\n\n' +
      '•  Entry Deadline: ' + edd + '\n' +
      '•  Light Cue Submission Deadline: ' + lcd + ' by ' + lct + '\n\n' +
      'If you have not yet submitted your entry, please do so as soon as possible. Late entries may not be accepted.\n\n' +
      'Please contact me if you have any questions.\n\n' +
      cmn + (cmp ? '\n' + cmp : ''),
  };
}

/**
 * Day-Before Reminder — venue, address, and timing the evening before. v12
 * EMAIL_TEMPLATES.daybefore.
 */
export function dayBeforeEmail(contest: Contest): EmailDraft {
  const cn = contestFullName(contest.identity) || '[Contest Name]';
  const dt = fmtDateShort(contest.details.contestDate) || '[Contest Date]';
  const ven = contest.identity.hostVenueName || '[Venue TBD]';
  const adr = contest.identity.hostAddress || '[Address TBD]';
  const dmt = contest.details.directorsMeetingTime || '[TBD]';
  const fst = contest.details.firstShowTime || '[TBD]';
  const cmn = contest.cmInfo.name || '[CM Name]';
  const cme = contest.cmInfo.email || '[CM Email]';
  const cmp = contest.cmInfo.phone || '';
  return {
    subject: cn + ' — Tomorrow’s Contest',
    body:
      'Dear Directors,\n\n' +
      'Just a reminder that the ' + cn + ' is tomorrow, ' + dt + '.\n\n' +
      'Venue: ' + ven + '\n' +
      'Address: ' + adr + '\n' +
      'Directors’ Meeting: ' + dmt + '\n' +
      'First Performance: ' + fst + '\n\n' +
      'Please arrive prepared and on time. I look forward to seeing you tomorrow!\n\n' +
      cmn + '\n' + cme + (cmp ? '\n' + cmp : ''),
  };
}

/**
 * Judge Reminder — the arrival, venue, running order, and critique-format email
 * to the adjudicators. v12 EMAIL_TEMPLATES.judges.
 *
 * Two derived pieces, both required by issue #24's acceptance criteria:
 *  • the show list is docSchools() — performance order, with v12's "School N"
 *    blank-name fallback — numbered 1..n in running order;
 *  • the requested arrival time is the directors'-meeting time minus 20 minutes
 *    (parseTime → −20 → fmtTime), falling back to prose when the meeting time
 *    is blank or unparseable, exactly as v12.
 */
export function judgesEmail(contest: Contest): EmailDraft {
  const cn = contestFullName(contest.identity) || '[Contest Name]';
  const dt = fmtDateShort(contest.details.contestDate) || '[Contest Date TBD]';
  const ven = contest.identity.hostVenueName || '[Venue TBD]';
  const adr = contest.identity.hostAddress || '[Address TBD]';
  const dmtDisplay = contest.details.directorsMeetingTime || '[TBD]';
  const dmtMin = parseTime(contest.details.directorsMeetingTime);
  const arrDisplay =
    dmtMin != null && !isNaN(dmtMin)
      ? fmtTime(dmtMin - 20)
      : '[at least 20 minutes before the Directors’ Meeting]';
  const cfText = contest.details.critiqueFormat === 'after_each' ? 'after each show' : 'after all shows';
  const showList = docSchools(contest)
    .map((s, i) => i + 1 + '. ' + s.name + (s.play ? ' — ' + s.play : ''))
    .join('\n');
  const cmn = contest.cmInfo.name || '[CM Name]';
  const cme = contest.cmInfo.email || '[CM Email]';
  const cmp = contest.cmInfo.phone || '';
  return {
    subject: cn + ' — Judge Information',
    body:
      'Dear Judge,\n\n' +
      'The ' + cn + ' is coming up on ' + dt + '. We are so excited to have you adjudicate!\n\n' +
      'Venue: ' + ven + '\n' +
      'Address: ' + adr + '\n\n' +
      'The Directors’ Meeting begins promptly at ' + dmtDisplay + ', so please plan to arrive by ' + arrDisplay +
      ' to get settled in.\n\n' +
      'Shows will run back to back in the following order:\n\n' + showList + '\n\n' +
      'Critiques will be randomly drawn, and will be held ' + cfText + '.\n\n' +
      'If you have any questions or concerns before contest day, please don’t hesitate to reach out.\n\n' +
      cmn + '\nContest Manager\n' + cme + (cmp ? '\n' + cmp : ''),
  };
}

/** The four one-click templates, keyed for the composer's button row. */
export const EMAIL_TEMPLATES: Record<EmailTemplateId, (contest: Contest) => EmailDraft> = {
  announcement: announcementEmail,
  deadline: deadlineEmail,
  daybefore: dayBeforeEmail,
  judges: judgesEmail,
};

/**
 * Post-Contest Evaluation — the advancing-schools email. Unlike the four
 * one-click templates it is addressed to a chosen SUBSET of schools: the CM
 * checks the schools that advanced and only their directors are emailed (issue
 * #24 acceptance criterion). v12 generateAdvancingEmail.
 *
 * @param selectedSchoolIndices 0-based indices into contest.schools (form order)
 *   for the checked schools. Out-of-range indices are ignored. The returned
 *   `to` list is those schools' director emails, blanks skipped, in form order.
 */
export function advancingEmail(contest: Contest, selectedSchoolIndices: number[]): AdvancingDraft {
  const cn = contestFullName(contest.identity) || '[Contest Name]';
  const cmn = contest.cmInfo.name || 'Allen';
  const cmp = contest.cmInfo.phone || '281-777-8672';
  const cmw = contest.cmInfo.website || 'www.allenotto.com';

  const to: string[] = [];
  for (const i of selectedSchoolIndices) {
    const school = contest.schools[i];
    if (!school) continue;
    for (const d of school.directors) {
      const email = d.email.trim();
      if (email) to.push(email);
    }
  }

  return {
    to,
    subject: cn + ' — Post-Contest Evaluation',
    body:
      'Good morning, directors:\n\n' +
      'Thank you so much for an amazing contest yesterday.  It is always such a pleasure to work with you all.  ' +
      'I know you all appreciate the amazing work you do every year.\n\n' +
      'As promised, please take some time to fill out the contest evaluation.  It is truly helpful for our adjudicator ' +
      'process to get this kind of feedback.  It is also reviewed by TTAO when determining Area, Region, and State judges.  ' +
      'It takes about 5 minutes, but makes a WORLD of difference.  Thank you in advance.\n\n' +
      cn + ' Director\'s Evaluation\n[PASTE EVALUATION LINK HERE]\n\n' +
      'As always, do not hesitate to reach out if you have any questions or if there is anything I can do to make your ' +
      'season more enjoyable from here.\n\n' +
      'Play with love,\n' + cmn + '\n' + cmp + (cmw ? '\n' + cmw : ''),
  };
}
