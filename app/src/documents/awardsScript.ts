/**
 * Awards Ceremony Script (.docx).
 *
 * Ported from v12 genAwardsScript (_Templates/OAP Contest Setup.html, lines
 * ~2412–2471). Fixed ceremony language with a per-school block for Outstanding
 * Technicians and blanks the CM fills in during awards.
 *
 * As of PRD #66 (Group C) the script also FILLS from recorded results: when the
 * contest has results (resolveResults(contest) !== null) the acting-award,
 * Outstanding Technicians, Best Crew, Advancing, and "Next Level of Competition"
 * sections list the actual winners/companies instead of blanks. Advancing
 * companies are announced in NO PARTICULAR ORDER (the derivation drops rank), and
 * the Next-Level section reads the always-present `nextContest` block. When no
 * results are recorded (resolveResults returns null) the builder emits exactly
 * the blank fill-in template it always did.
 *
 * Pure except makeDocx (JSZip). No date is stamped — the only date shown is the
 * next contest's, formatted from the stored ISO string, so output stays
 * deterministic without a ctx.
 */

import { contestTitleLong, type Contest } from '../model/contest';
import {
  resolveResults,
  type ResolvedCompany,
  type ResolvedResults,
  type ResolvedWinner,
} from '../model/results';
import { docSchools } from './docVars';
import { fmtDateShort } from './format';
import {
  makeDocx,
  ooP,
  ooPEmpty,
  ooPHead,
  ooPLine,
  ooPSignLine,
} from './ooxml';

/** Display label for the level a contest advances to (mirrors v12's nextLevel map). */
const NEXT_LEVEL_LABEL: Record<string, string> = {
  Zone: 'District',
  District: 'Bi-District',
  BiDistrict: 'Area',
  Area: 'Region',
  Region: 'State',
};

/** "School — Play" (play omitted when blank). */
function companyLine(c: ResolvedCompany): string {
  return c.schoolName + (c.play ? ' — ' + c.play : '');
}

/** "Student — School". */
function winnerLine(w: ResolvedWinner): string {
  return w.studentName + ' — ' + w.schoolName;
}

/** A muted italic "nothing recorded" placeholder used inside a filled section. */
function noneLine(sa: number): string {
  return ooP('None recognized.', { size: 20, color: '888888', italic: true, sa });
}

/**
 * Outstanding Technicians section. Blank ⇒ a per-school signature block the CM
 * fills live; filled ⇒ the recorded technicians (one per school), keeping the
 * same intro line.
 */
function outstandingTechniciansSection(
  results: ResolvedResults | null,
  schools: ReturnType<typeof docSchools>,
  numJudges: number,
): string[] {
  const intro = ooP(
    'The following students have been recognized by our adjudicator' +
      (numJudges > 1 ? 's' : '') +
      ' for Outstanding Technical Achievement:',
    { size: 20, sa: 120 },
  );
  if (results === null) {
    return [
      ooPHead('Outstanding Technicians'),
      intro,
      ...schools.flatMap((s) => [
        ooP(s.name + (s.play ? ' — ' + s.play : ''), { size: 20, bold: true, sa: 20 }),
        ooPSignLine(360, 100),
      ]),
      ooPEmpty(80),
    ];
  }
  const techs = results.outstandingTechnicians;
  return [
    ooPHead('Outstanding Technicians'),
    intro,
    ...(techs.length
      ? techs.map((w) => ooP(winnerLine(w), { size: 20, bold: true, sa: 40 }))
      : [noneLine(40)]),
    ooPEmpty(80),
  ];
}

/** Best Crew section: a blank signature line, or the recorded crew's company. */
function bestCrewSection(results: ResolvedResults | null): string[] {
  if (results === null) {
    return [ooPHead('Best Crew'), ooPSignLine(0, 200)];
  }
  return [
    ooPHead('Best Crew'),
    results.bestCrew
      ? ooP(companyLine(results.bestCrew), { size: 20, bold: true, sa: 200 })
      : noneLine(200),
  ];
}

/**
 * One acting-award section (Best Performers / All-Star / Honorable Mention).
 * Blank ⇒ the "USE ACTING AWARDS FORM" reminder; filled ⇒ the recorded winners.
 */
function actingAwardSection(
  title: string,
  results: ResolvedResults | null,
  winners: ResolvedWinner[],
): string[] {
  if (results === null) {
    return [
      ooPHead(title),
      ooP('USE ACTING AWARDS FORM', { size: 20, bold: true, color: 'C00000', sa: 200 }),
    ];
  }
  return [
    ooPHead(title),
    ...(winners.length
      ? winners.map((w) => ooP(winnerLine(w), { size: 20, bold: true, sa: 40 }))
      : [noneLine(40)]),
    ooPEmpty(120),
  ];
}

/**
 * Next Level of Competition section, filled from the always-present `nextContest`
 * block (blank ⇒ the italic placeholder prompt). Any date shown is formatted from
 * the stored ISO string — no clock read.
 */
function nextLevelSection(contest: Contest, results: ResolvedResults | null): string[] {
  if (results === null) {
    return [
      ooPHead('Next Level of Competition'),
      ooP('[Announce the next contest level and location if known.]', {
        size: 20,
        color: '888888',
        italic: true,
        sa: 200,
      }),
    ];
  }
  const nc = contest.nextContest;
  const label = NEXT_LEVEL_LABEL[contest.identity.contestLevel] || 'next-level';
  const date = fmtDateShort(nc.date);
  const cm = nc.cmName
    ? nc.cmName + (nc.cmEmail ? ' (' + nc.cmEmail + ')' : '')
    : '';
  return [
    ooPHead('Next Level of Competition'),
    ooP(
      'The advancing companies will continue to the ' +
        label +
        ' contest' +
        (nc.location ? ', hosted at ' + nc.location : '') +
        '.',
      { size: 20, sa: 80 },
    ),
    ooP('Date: ' + (date || 'To be announced.'), { size: 20, sa: 40 }),
    ...(cm ? [ooP('Contest Manager: ' + cm, { size: 20, sa: 40 })] : []),
    ...(nc.cmPhone ? [ooP('Phone: ' + nc.cmPhone, { size: 20, sa: 40 })] : []),
    ooPEmpty(160),
  ];
}

/**
 * Advancing Shows section. Blank ⇒ placement-labelled signature lines the CM
 * fills live; filled ⇒ an UNORDERED list of advancing companies (no 1st/2nd/3rd
 * labels — the derivation drops rank) plus the alternate.
 */
function advancingSection(results: ResolvedResults | null): string[] {
  if (results === null) {
    return [
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
    ];
  }
  const { advancing, alternate } = results;
  return [
    ooPHead('Advancing Shows'),
    ooP('The following companies advance to the next level of competition, in no particular order:', {
      size: 20,
      sa: 80,
    }),
    ...(advancing.length
      ? advancing.map((c) => ooP(companyLine(c), { size: 20, bold: true, sa: 40 }))
      : [noneLine(40)]),
    ooPEmpty(40),
    ...(alternate ? [ooP('Alternate: ' + companyLine(alternate), { size: 20, sa: 40 })] : []),
    ooPEmpty(80),
  ];
}

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
  const results = resolveResults(contest);

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

    ...outstandingTechniciansSection(results, schools, numJudges),

    ...bestCrewSection(results),

    ...actingAwardSection('Honorable Mention All-Star Cast', results, results?.honorableMention ?? []),

    ...actingAwardSection('All-Star Cast', results, results?.allStarCast ?? []),

    ...actingAwardSection('Best Performers', results, results?.bestPerformers ?? []),

    ...nextLevelSection(contest, results),

    ...advancingSection(results),

    ooP('Congratulations to all participants! Thank you for an outstanding contest.', { size: 20, italic: true, align: 'center', sa: 0 }),
  ];
  return await makeDocx(parts.filter(Boolean).join(''));
}
