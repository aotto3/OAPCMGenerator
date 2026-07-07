/**
 * Awards Ceremony Script (.docx).
 *
 * Ported from v12 genAwardsScript (_Templates/OAP Contest Setup.html, lines
 * ~2412–2471). Fixed ceremony language with a per-school block for Outstanding
 * Technicians and blanks the CM fills in during awards. The only contest inputs
 * are the title, host school, judge names, and the schools list — read from the
 * Contest record here (v12 read them from its flat `vars` bag).
 *
 * Pure except makeDocx (JSZip). No date is stamped, so no ctx is needed.
 */

import { contestTitleLong, type Contest } from '../model/contest';
import { docSchools } from './docVars';
import {
  makeDocx,
  ooP,
  ooPEmpty,
  ooPHead,
  ooPLine,
  ooPSignLine,
} from './ooxml';

/** Builds the Awards Script for a contest. The registry's `awards` entry delegates here. */
export async function buildAwardsScript(contest: Contest): Promise<Uint8Array> {
  const id = contest.identity;
  const numJudges = contest.details.numJudges;

  const judgeNames: string[] = [];
  for (let i = 1; i <= numJudges; i++) {
    const n = contest.adjudicators[i - 1]?.name;
    if (n) judgeNames.push(n);
  }
  const hs = id.hostSchoolName || '[Host School]';
  const titleLong = contestTitleLong(id);
  const schools = docSchools(contest);

  const parts = [
    ooP(titleLong, { bold: true, size: 28, color: '1F4E79', align: 'center', sb: 0, sa: 60 }),
    ooP('Awards Ceremony Script', { size: 22, color: '555555', align: 'center', sa: 200 }),
    ooPLine('2E75B6'),
    ooPEmpty(80),

    ooPHead('Welcome & Thank Yous'),
    ooP('Good [morning/evening], and welcome to the ' + titleLong + '. My name is [NAME], and I am your Contest Manager.', { size: 20, sa: 120 }),
    ooP('On behalf of ' + hs + ', I want to thank everyone for joining us today and congratulate all ' + schools.length + ' schools for their hard work. I would like to recognize our adjudication panel:', { size: 20, sa: 80 }),
    ...(judgeNames.length ? judgeNames : ['[Judge Names]']).map((j) => ooP(j, { size: 20, bold: true, indent: 360, sa: 40 })),
    ooPEmpty(60),
    ooP('I also want to thank our technical staff, site crew, and host school—' + hs + '.', { size: 20, sa: 80 }),
    ooP('Thank you to all of the directors for your hard work and dedication.', { size: 20, sa: 80 }),
    ooP('And to friends and family—thank you for your love and support of these students.', { size: 20, sa: 200 }),

    ooPHead('Contest Courtesy'),
    ooP('Before we begin our awards, a reminder of contest courtesy. Please silence all cell phones and electronic devices. We ask that you remain seated and hold your applause until directed, and that you be respectful and supportive of all participating schools.', { size: 20, sa: 200 }),

    ooPHead('Outstanding Technicians'),
    ooP('The following students have been recognized by our adjudicator' + (numJudges > 1 ? 's' : '') + ' for Outstanding Technical Achievement:', { size: 20, sa: 120 }),
    ...schools.flatMap((s) => [
      ooP(s.name + (s.play ? ' — ' + s.play : ''), { size: 20, bold: true, sa: 20 }),
      ooPSignLine(360, 100),
    ]),
    ooPEmpty(80),

    ooPHead('Best Crew'),
    ooPSignLine(0, 200),

    ooPHead('Honorable Mention All-Star Cast'),
    ooP('USE ACTING AWARDS FORM', { size: 20, bold: true, color: 'C00000', sa: 200 }),

    ooPHead('All-Star Cast'),
    ooP('USE ACTING AWARDS FORM', { size: 20, bold: true, color: 'C00000', sa: 200 }),

    ooPHead('Best Performers'),
    ooP('USE ACTING AWARDS FORM', { size: 20, bold: true, color: 'C00000', sa: 200 }),

    ooPHead('Next Level of Competition'),
    ooP('[Announce the next contest level and location if known.]', { size: 20, color: '888888', italic: true, sa: 200 }),

    ooPHead('Advancing Shows'),
    ooP('Alternate:', { size: 20, sa: 20 }),
    ooPSignLine(360, 80),
    ooP('3rd Place — Advancing:', { size: 20, sa: 20 }),
    ooPSignLine(360, 80),
    ooP('2nd Place — Advancing:', { size: 20, sa: 20 }),
    ooPSignLine(360, 80),
    ooP('1st Place — Advancing:', { size: 20, sa: 20 }),
    ooPSignLine(360, 120),
    ooPEmpty(80),

    ooP('Congratulations to all participants! Thank you for an outstanding contest.', { size: 20, italic: true, align: 'center', sa: 0 }),
  ];
  return await makeDocx(parts.filter(Boolean).join(''));
}
