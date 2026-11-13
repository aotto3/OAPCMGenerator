/**
 * Starter texts for "+ New template" (PRD #320): each built-in email's subject
 * and body rewritten with merge fields, so a CM's copy works in every contest.
 * The built-in emails themselves (documents/emailTemplates.ts) are unchanged
 * and stay locked; these are static data, used only to start a new template.
 *
 * The wording is the built-ins' own, character for character, so that a starter
 * rendered against a contest reads like the built-in. Where a built-in has logic
 * a template cannot express, the starter is an approximation:
 *  - an optional detail the built-in drops when blank (CM phone, website) sits
 *    on its own line, which is left empty instead;
 *  - Advancing Schools leaves the To: line to the CM, like every custom template;
 *  - Tabulation to State Office cannot compute the advancing plays or the
 *    tabulation report, so it carries bracketed paste-here lines instead.
 */
import type { TemplateInput } from './templateRules';

export interface Starter {
  /** Matches the composer's built-in button. */
  id: string;
  /** The built-in's name, as the composer labels it. */
  label: string;
  subject: string;
  body: string;
}

export const STARTERS: readonly Starter[] = [
  {
    id: 'announcement',
    label: 'Contest Announcement',
    subject: '{{contestName}} — Contest Information',
    body:
      'Dear {{contestLevel}} Directors,\n\n' +
      'Congratulations on qualifying for the {{contestName}}! I am looking forward to serving as your Contest Manager.\n\n' +
      'The contest will be held on {{contestDate}} at {{venueName}}, located at {{venueAddress}}.\n\n' +
      'Directors’ Meeting: {{directorsMeetingTime}}\n' +
      'First Performance: {{firstShowTime}}\n\n' +
      'Please submit your entries by {{entryDeadline}}.\n\n' +
      'If you have any questions, please contact me at {{cmEmail}} or {{cmPhone}}.\n\n' +
      'Sincerely,\n{{cmName}}\nContest Manager',
  },
  {
    id: 'deadline',
    label: 'Entry Deadline Reminder',
    subject: '{{contestName}} — Entry Deadline Reminder',
    body:
      'Dear Directors,\n\n' +
      'This is a reminder of the upcoming deadlines for the {{contestName}}:\n\n' +
      '•  Entry Deadline: {{entryDeadline}}\n' +
      '•  Light Cue Submission Deadline: {{lightCueDeadline}}\n\n' +
      'If you have not yet submitted your entry, please do so as soon as possible. Late entries may not be accepted.\n\n' +
      'Please contact me if you have any questions.\n\n' +
      '{{cmName}}\n{{cmPhone}}',
  },
  {
    id: 'daybefore',
    label: 'Day-Before Reminder',
    subject: '{{contestName}} — Tomorrow’s Contest',
    body:
      'Dear Directors,\n\n' +
      'Just a reminder that the {{contestName}} is tomorrow, {{contestDateShort}}.\n\n' +
      'Venue: {{venueName}}\n' +
      'Address: {{venueAddress}}\n' +
      'Directors’ Meeting: {{directorsMeetingTime}}\n' +
      'First Performance: {{firstShowTime}}\n\n' +
      'Please arrive prepared and on time. I look forward to seeing you tomorrow!\n\n' +
      '{{cmName}}\n{{cmEmail}}\n{{cmPhone}}',
  },
  {
    id: 'questionnaire',
    label: 'Judge Questionnaire',
    subject: '{{contestName}} - Adjudicator Questionnaire',
    body:
      'Dear Judges,\n\n' +
      'Thank you for agreeing to adjudicate the {{contestName}} on {{contestDate}}. The contest will be held at {{venueName}}, {{venueAddress}}.\n\n' +
      'To help me plan for contest day, please take a few minutes to fill out the adjudicator questionnaire. ' +
      'It asks for your contact information, a mailing address for scripts, hotel nights, dietary needs, and ' +
      'anything else that would make the day easier for you. When it asks for your email, use the address this ' +
      'message was sent to.\n\n' +
      'Adjudicator Questionnaire: {{questionnaireLink}}\n\n' +
      'I will send a full schedule and show order closer to the contest. Please reach out with any questions.\n\n' +
      '{{cmName}}\nContest Manager\n{{cmEmail}}\n{{cmPhone}}',
  },
  {
    id: 'judges',
    label: 'Judge Reminder',
    subject: '{{contestName}} — Judge Information',
    body:
      'Dear Judge,\n\n' +
      'The {{contestName}} is coming up on {{contestDateShort}}. We are so excited to have you adjudicate!\n\n' +
      'Venue: {{venueName}}\n' +
      'Address: {{venueAddress}}\n\n' +
      'The Directors’ Meeting begins promptly at {{directorsMeetingTime}}, so please plan to arrive by {{judgeArrivalTime}}' +
      ' to get settled in.\n\n' +
      'Shows will run back to back in the following order:\n\n{{showOrder}}\n\n' +
      'Critiques will be randomly drawn, and will be held {{critiqueTiming}}.\n\n' +
      'If you have any questions or concerns before contest day, please don’t hesitate to reach out.\n\n' +
      '{{cmName}}\nContest Manager\n{{cmEmail}}\n{{cmPhone}}',
  },
  {
    id: 'judgeneeds',
    label: 'Judge Needs',
    subject: '{{contestName}} — Judge Needs',
    body: "For the {{contestName}}, the judges' needs are as follows:\n\n{{judgeNeeds}}",
  },
  {
    id: 'advancing',
    label: 'Advancing Schools',
    subject: '{{contestName}} — Post-Contest Evaluation',
    body:
      'Good morning, directors:\n\n' +
      'Thank you so much for an amazing contest yesterday.  It is always such a pleasure to work with you all.  ' +
      'I know you all appreciate the amazing work you do every year.\n\n' +
      'As promised, please take some time to fill out the contest evaluation.  It is truly helpful for our adjudicator ' +
      'process to get this kind of feedback.  It is also reviewed by TTAO when determining Area, Region, and State judges.  ' +
      'It takes about 5 minutes, but makes a WORLD of difference.  Thank you in advance.\n\n' +
      "{{contestName}} Director's Evaluation\n[PASTE EVALUATION LINK HERE]\n\n" +
      'As always, do not hesitate to reach out if you have any questions or if there is anything I can do to make your ' +
      'season more enjoyable from here.\n\n' +
      'Play with love,\n{{cmName}}\n{{cmPhone}}\n{{cmWebsite}}',
  },
  {
    id: 'tabulation',
    label: 'Tabulation to State Office',
    subject: '{{contestName}} - Panel Tabulation',
    body:
      '[Before sending: attach Panel Tabulation.pdf from the documents ZIP, then delete this line.]\n\n' +
      'Attached is the panel tabulation for the {{contestName}}.\n' +
      'The advancing plays are:\n' +
      '[List each advancing play and its directors’ emails here]\n\n' +
      '[Paste the tabulation report from the Tabulation to State Office email here]\n\n' +
      '{{cmName}}\nContest Manager',
  },
];

/**
 * A new template's starting text from a starter, named "My <built-in>" (with a
 * number added when the CM already has that name), ready for the editor.
 */
export function starterInput(starter: Starter, existingNames: readonly string[]): TemplateInput {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const base = `My ${starter.label}`;
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  return { name, subject: starter.subject, body: starter.body };
}
