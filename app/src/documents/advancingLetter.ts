/**
 * Advancing Schools Letter (.docx).
 *
 * Ported from v12 genAdvancingLetter (_Templates/OAP Contest Setup.html, lines
 * ~2844–2894). Fixed congratulatory language sent to a company that advanced,
 * with blanks the CM fills per school (placement) and a computed "next level"
 * derived from this contest's level.
 *
 * DETERMINISM: v12 stamped the letter with `new Date().toLocaleDateString(...)`.
 * The date is injectable here via options.now (mirroring letter.ts) and formatted
 * with format.ts, so the golden file is stable. Defaults to build time in
 * production, where the stamp should read "today".
 *
 * Pure except makeDocx (JSZip).
 */

import { contestTitleLong, type Contest } from '../model/contest';
import { fmtDateShort, formatLongDate } from './format';
import { makeDocx, ooP, ooPBullet, ooPEmpty, ooPHead, ooPLine, ooTable2Col } from './ooxml';

export interface AdvancingLetterOptions {
  /** Date printed at the top. v12 used the clock; injectable so the golden is stable. */
  now?: Date;
}

/** The level each contest level advances to (v12's nextLevel map). */
const NEXT_LEVEL: Record<string, string> = {
  Zone: 'District',
  District: 'Bi-District',
  BiDistrict: 'Area',
  Area: 'Region',
  Region: 'State',
};

/** Builds the Advancing Schools Letter. The registry's `advancing_letter` entry delegates here. */
export async function buildAdvancingLetter(
  contest: Contest,
  options: AdvancingLetterOptions = {},
): Promise<Uint8Array> {
  const cm = contest.cmInfo;
  const id = contest.identity;

  const cmName = cm.name || 'Allen Otto';
  const cmEmail = cm.email || 'aotto3@gmail.com';
  const cmPhone = cm.phone || '';
  const cmAddress = cm.mailingAddress || '';

  const today = formatLongDate(options.now ?? new Date());
  const lv = id.contestLevel || 'District';
  const nextLevel = NEXT_LEVEL[lv] || 'next level';
  // v12 pre-formatted bidc_contest_date with fmtDateShort into `vars`, then applied
  // `|| 'TBD'`; a blank BiDistrict date therefore prints "TBD" (the row's own
  // "____" fallback below is dead code, as in v12). Reproduced faithfully.
  const nextDate = fmtDateShort(contest.details.bidcContestDate) || 'TBD';
  const hs = id.hostSchoolName || '[Host School]';

  const titleLong = contestTitleLong(id);

  const parts = [
    ooP(cmName, { bold: true, size: 26, color: '1F4E79', sb: 0, sa: 40 }),
    ooP('UIL One-Act Play Contest Manager', { size: 18, color: '555555', sa: 20 }),
    cmEmail ? ooP(cmEmail, { size: 18, color: '2E75B6', sa: 20 }) : '',
    cmPhone ? ooP(cmPhone, { size: 18, color: '555555', sa: 20 }) : '',
    ooPLine('2E75B6'),
    ooPEmpty(160),
    ooP(today, { size: 20, sa: 200 }),

    ooP('Dear [Director Name] and Company,', { size: 20, sa: 120 }),
    ooP('Congratulations! On behalf of the ' + titleLong + ', it is my pleasure to inform you that your company has advanced to the ' + nextLevel + ' level of competition. Your hard work and dedication have earned you this honor, and I know your students and staff have much to be proud of.', { size: 20, sa: 200 }),

    ooPHead('Your Placement'),
    ooTable2Col([
      ['School:', '___________________________________'],
      ['Placement:', '___________________________________'],
      ['Advancing to:', nextLevel],
      ['Next Contest Date:', nextDate || '___________________________________'],
    ]),
    ooPEmpty(120),

    ooPHead('Next Steps'),
    ooP('You will be contacted by the ' + nextLevel + ' Contest Manager with information about the next contest, including the location, schedule, and any additional requirements. In the meantime:', { size: 20, sa: 80 }),
    ooPBullet('Maintain eligibility for all cast and crew members through the next contest.'),
    ooPBullet('Ensure all royalty payments, publisher approvals, and UIL paperwork remain current.'),
    ooPBullet('Do not make any changes to your production without consulting the next Contest Manager.'),
    ooPBullet('Be prepared to submit scripts to the next level’s adjudicators once mailing addresses are provided.'),
    ooPEmpty(120),

    ooPHead('Acting Awards'),
    ooP('Acting awards (All-Star Cast, Honorable Mention All-Star Cast, Best Performers) earned at this contest do not automatically carry over to the ' + nextLevel + '. The ' + nextLevel + ' adjudicators will make their own selections independently.', { size: 20, sa: 120 }),

    ooP('Please do not hesitate to contact me with any questions. It has been a pleasure working with you this season.', { size: 20, sa: 200 }),
    ooP('Play with Love,', { size: 20, sa: 360 }),
    ooP(cmName + ', J.D.', { bold: true, size: 20, sa: 40 }),
    ooP('UIL One-Act Play Contest Manager', { size: 18, color: '555555', sa: 20 }),
    cmPhone ? ooP(cmPhone, { size: 18, color: '555555', sa: 20 }) : '',
    cmEmail ? ooP(cmEmail, { size: 18, color: '2E75B6', sa: 20 }) : '',
    cmAddress ? ooP(cmAddress, { size: 18, color: '555555', sa: 20 }) : '',
    ooPEmpty(120),
    ooP('Contest Site: ' + hs, { size: 18, color: '555555', sa: 0 }),
  ];
  return await makeDocx(parts.filter(Boolean).join(''));
}
