/**
 * Contest Day Director's Meeting Agenda (.docx).
 *
 * Ported from v12 genDirectorsMeetingScript (_Templates/OAP Contest Setup.html,
 * lines ~2476–2553). The running order of the meeting is the spec: introductions
 * → judges address the group → critique order → evaluations → dismiss judges →
 * cue documentation (per school) → timing → dressing rooms → additional items.
 *
 * CRITIQUE ASSIGNMENTS (issue #23, was the #21 AC3 seam): the Critique Order
 * section lists the LOCKED critique assignment beneath the format sentence.
 * Only a locked assignment appears (matching v12, which froze/consumed only
 * locked results); an unlocked, absent, or stale (school-count-mismatched)
 * assignment leaves the section in its original no-assignments state — that
 * path is byte-for-byte what shipped before #23, so the golden is unchanged.
 * The rows come from critiqueRows() (documents/docVars.ts); the randomizer
 * itself is model/critique.ts. The rest of the agenda is fixed language.
 *
 * v12 also computed `first_show_time` and `host_school_name` locals that its
 * body never used; those dead assignments are dropped here (output unchanged).
 *
 * Pure except makeDocx (JSZip). No "today" is stamped, so no ctx is needed.
 */

import { contestTitleLong, type Contest } from '../model/contest';
import { fmtDateShort } from './format';
import { critiqueRows, docSchools } from './docVars';
import { makeDocx, ooP, ooPBullet, ooPEmpty, ooPHead, ooPLine } from './ooxml';

/** Builds the Directors Meeting Agenda. The registry's `directors_meeting` entry delegates here. */
export async function buildDirectorsMeeting(contest: Contest): Promise<Uint8Array> {
  const id = contest.identity;
  const d = contest.details;

  const cd = fmtDateShort(d.contestDate) || 'TBD';
  const dm = d.directorsMeetingTime || 'TBD';
  const critAfterEach = d.critiqueFormat === 'after_each';

  const judges: string[] = [];
  for (let i = 1; i <= d.numJudges; i++) {
    const n = contest.adjudicators[i - 1]?.name;
    if (n) judges.push(n);
  }
  const schools = docSchools(contest);

  // Critique assignments appear here only once LOCKED (issue #23 + the seam
  // above), matching v12, which froze and consumed only the locked result. An
  // unlocked or stale assignment leaves the section in its no-assignments state.
  const critAssign = contest.critique?.locked ? critiqueRows(contest) : null;

  const cmName = contest.cmInfo.name || 'Allen Otto';
  const cmEmail = contest.cmInfo.email || 'aotto3@gmail.com';
  const cmPhone = contest.cmInfo.phone || '';

  const parts = [
    ooP(contestTitleLong(id), { bold: true, size: 26, color: '1F4E79', align: 'center', sb: 0, sa: 40 }),
    ooP('Contest Day Director’s Meeting Agenda', { size: 20, color: '555555', align: 'center', sa: 40 }),
    ooP(cd + ' • ' + dm, { size: 18, color: '888888', align: 'center', sa: 120 }),
    ooPLine('2E75B6'),
    ooPEmpty(80),

    ooPHead('Introductions'),
    ooPBullet('Directors — please introduce yourself and your school.'),
    ooPBullet('Timekeepers introduced.'),
    ooPEmpty(100),

    ooPHead('Judges — Address the Group'),
    ...(judges.length
      ? judges
          .map((j) => [
            ooP(j, { size: 20, bold: true, indent: 360, sa: 20 }),
            ooP('Email: ___________________________________', { size: 18, indent: 360, sa: 60 }),
          ])
          .flat()
      : [ooP('[Judge Names]', { size: 20, indent: 360, sa: 60 })]),
    ooPEmpty(40),
    ooP('[CM: Invite judge(s) to speak. Directors may ask questions.]', { size: 20, color: '888888', italic: true, sa: 80 }),
    ooP('Reminder: Judges are asked to evaluate the execution of choices and not the choice of play or cutting.', { size: 20, bold: true, sa: 80 }),
    ooPBullet('Any physical issues or other concerns that need to be disclosed to the judges? [Ask directors]'),
    ooPBullet('Any actor changes? [Note in the program]'),
    ooPEmpty(100),

    ooPHead('Critique Order'),
    ooP(
      critAfterEach
        ? 'Critiques will be given after each performance — order randomly chosen, announced after each show.'
        : 'Critiques will be given after all performances — order randomly chosen, announced after the last show.',
      { size: 20, sa: critAssign ? 40 : 100 },
    ),
    // Locked assignments only (unlocked/absent ⇒ this whole block is empty and
    // the section reads exactly as it did before #23 landed — golden stable).
    ...(critAssign
      ? [
          ooP('Judge assignments:', { size: 20, bold: true, sa: 40 }),
          ...critAssign.map((r) =>
            ooP(
              `${r.order}. ${r.school}${r.play ? ' — ' + r.play : ''}:  Judge ${r.judgeNumber}` +
                (r.judgeName ? ' — ' + r.judgeName : ''),
              { size: 18, indent: 360, sa: 20 },
            ),
          ),
          ...(critAfterEach
            ? [ooP('(After each show — Judge 1 is not assigned the last school.)', { size: 16, color: '888888', italic: true, sa: 80 })]
            : []),
          ooPEmpty(40),
        ]
      : []),
    ooPEmpty(40),

    ooPHead('Evaluations'),
    ooP('Evaluations for the contest will go out after via e-mail. Please fill them out. It takes only a moment and is often the only feedback a judge will get.', { size: 20, sa: 80 }),
    ooPEmpty(80),

    ooP('►►  DISMISS THE JUDGES  ◄◄', { bold: true, size: 22, color: 'C00000', align: 'center', sa: 100 }),
    ooPEmpty(60),

    ooPHead('Opening / Closing Cues Documentation'),
    ooP('Review opening and closing cue documentation with timekeepers for each school:', { size: 20, sa: 60 }),
    ...schools.flatMap((s) => [
      ooP(s.name + (s.play ? ' — ' + s.play : '') + ':  Opening ____________  Closing ____________', { size: 18, indent: 360, sa: 20 }),
      ooP('Outstanding Technician: ___________________________________', { size: 18, indent: 360, sa: 40 }),
    ]),
    ooPEmpty(80),

    ooPHead('Backstage Timekeeper — Timing'),
    ooPBullet('Set & Strike: 1-minute interval warnings from the backstage timekeeper.'),
    ooPBullet('Performance: Warnings given when 15 and 35 minutes have elapsed.'),
    ooPBullet('Additional warnings at 4, 3, 2, 1 min, 30 sec, and 15 sec.'),
    ooPBullet('No other warnings will be given.'),
    ooPBullet('Reminder to stage managers: note the pre-show announcement timing cue.'),
    ooPEmpty(80),

    ooPHead('Dressing Rooms'),
    ooP('Only directors, actors, crew members, and alternates are permitted in dressing rooms.', { size: 20, sa: 80 }),
    ooPEmpty(80),

    ooPHead('Additional Items'),
    ooPBullet('Any students with disabilities or other issues that need to be disclosed to the judges?'),
    ooPBullet('Alternate — announced publicly or no?'),
    ooP('Admission into the Contest for participants: ___________________________', { size: 20, indent: 360, sa: 80 }),
    ooPEmpty(80),

    ooP('ANY OTHER QUESTIONS?', { bold: true, size: 22, color: '1F4E79', align: 'center', sa: 120 }),
    ooPEmpty(60),
    ooP('Contest Manager: ' + cmName + (cmPhone ? ' • ' + cmPhone : '') + (cmEmail ? ' • ' + cmEmail : ''), { size: 18, color: '555555', align: 'center', sa: 0 }),
  ];
  return await makeDocx(parts.filter(Boolean).join(''));
}
