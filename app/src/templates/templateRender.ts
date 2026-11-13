/**
 * The custom email template renderer (PRD #320). PURE: a template's subject and
 * body plus a Contest go in; the filled subject and body come out, with the
 * merge fields the renderer did not recognize.
 *
 * Merge fields are written `{{fieldName}}` (spaces inside the braces are
 * allowed). There is no conditional logic. Each field reads the same value the
 * built-in emails read (emailTemplates.ts), formatted the same way. When the
 * contest has no value yet, a required field renders a bracketed placeholder
 * such as [Venue TBD] so the CM notices before sending, and an optional field
 * (CM phone, website) renders nothing.
 *
 * An unrecognized field (a typo, or one this version does not know) is left in
 * the text exactly as typed and reported, so the editor can warn about it.
 *
 * MERGE_FIELDS is the catalog the editor's picker lists, in picker order.
 */
import { contestFullName, type Contest } from '../model/contest';
import { fmtDate, fmtDateShort } from '../documents/format';

export interface MergeField {
  /** What goes between the braces, e.g. `contestName`. */
  key: string;
  /** The picker label. */
  label: string;
  /** The contest's value, or '' when it has none yet. */
  value(contest: Contest): string;
  /** Shown when the value is blank; '' for an optional field. */
  blank: string;
}

const field = (key: string, label: string, value: (c: Contest) => string, blank: string): MergeField => ({
  key,
  label,
  value,
  blank,
});

export const MERGE_FIELDS: readonly MergeField[] = [
  field('contestName', 'Contest name', (c) => contestFullName(c.identity), '[Contest Name]'),
  field('contestLevel', 'Contest level', (c) => c.identity.contestLevel, '[Contest Level TBD]'),
  field('contestDate', 'Contest date', (c) => fmtDate(c.details.contestDate), '[Contest Date TBD]'),
  field('venueName', 'Venue name', (c) => c.identity.hostVenueName, '[Venue TBD]'),
  field('venueAddress', 'Venue address', (c) => c.identity.hostAddress, '[Address TBD]'),
  field(
    'directorsMeetingTime',
    'Directors’ meeting time',
    (c) => c.details.directorsMeetingTime,
    '[Directors’ Meeting Time TBD]',
  ),
  field('firstShowTime', 'First show time', (c) => c.details.firstShowTime, '[First Show Time TBD]'),
  field('entryDeadline', 'Entry deadline', (c) => fmtDateShort(c.details.entrySystemDeadline), '[Entry Deadline TBD]'),
  field(
    'lightCueDeadline',
    'Light cue deadline',
    // The built-in reminder's wording and default time: "March 1, 2027 by 5:00 PM".
    (c) => {
      const date = fmtDateShort(c.details.lightCueDeadlineDate);
      return date ? date + ' by ' + (c.details.lightCueDeadlineTime || '5:00 PM') : '';
    },
    '[Light Cue Deadline TBD]',
  ),
  field('cmName', 'CM name', (c) => c.cmInfo.name, '[CM Name]'),
  field('cmEmail', 'CM email', (c) => c.cmInfo.email, '[CM Email]'),
  field('cmPhone', 'CM phone', (c) => c.cmInfo.phone, ''),
  field('cmWebsite', 'CM website', (c) => c.cmInfo.website, ''),
];

const BY_KEY = new Map(MERGE_FIELDS.map((f) => [f.key, f]));

const FIELD_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** How a field is written in a template, e.g. `{{contestName}}`. */
export function mergeTag(key: string): string {
  return `{{${key}}}`;
}

export interface RenderedTemplate {
  subject: string;
  body: string;
  /** Unrecognized field names, each once, in the order first seen (subject, then body). */
  unknownFields: string[];
}

/** Fills a template's merge fields from the contest. */
export function renderTemplate(template: { subject: string; body: string }, contest: Contest): RenderedTemplate {
  const unknown: string[] = [];
  const fill = (text: string) =>
    text.replace(FIELD_PATTERN, (whole, key: string) => {
      const f = BY_KEY.get(key);
      if (!f) {
        if (!unknown.includes(key)) unknown.push(key);
        return whole;
      }
      const value = f.value(contest).trim();
      return value || f.blank;
    });
  const subject = fill(template.subject);
  const body = fill(template.body);
  return { subject, body, unknownFields: unknown };
}
