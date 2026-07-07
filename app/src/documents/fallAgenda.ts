/**
 * Fall District Meeting Agenda (.docx) — the planning-meeting agenda.
 *
 * Ported from v12 genFallAgenda (_Templates/OAP Contest Setup.html, lines
 * ~2674–2748). Numbered agenda with fill-in blanks; the contest inputs are the
 * identity (year/class/level, host site) and the schools list (registered
 * schools + a contact list).
 *
 * v12 FALLBACK FIDELITY: v12's `vars` bag pre-baked bracket placeholders for a
 * blank host/venue/address ("[Venue TBD]" etc.) and "TBD" for a blank directors'
 * meeting time, so each generator's inline `|| '___…'` fallback for THOSE fields
 * was unreachable — a blank venue prints "[Venue TBD]", not the underscores.
 * Fields WITHOUT a bag-level fallback (contest date via fmtDate → '', first show
 * time → '') do fall through to the "___" blanks. Both behaviors are reproduced.
 *
 * BIDC SECTION: v12 gates section 8 on `lv === 'Bi-District' || 'BIDC'`, but the
 * contest-level select value is "BiDistrict" — so that branch never fired in v12
 * and the BIDC section never rendered. Ported verbatim (isBidc stays false for a
 * real contest) rather than "fixing" it; the golden locks the real output.
 *
 * Pure except makeDocx (JSZip). No "today" is stamped, so no ctx is needed.
 */

import { type Contest } from '../model/contest';
import { fmtDate } from './format';
import { docSchools } from './docVars';
import { makeDocx, ooP, ooPBullet, ooPEmpty, ooPHead, ooPLine, ooTable2Col } from './ooxml';

/** Builds the Fall District Meeting Agenda. The registry's `fall_agenda` entry delegates here. */
export async function buildFallAgenda(contest: Contest): Promise<Uint8Array> {
  const id = contest.identity;
  const d = contest.details;

  const lv = id.contestLevel || 'District';
  const cls = id.classification || '';
  const yr = id.contestYear || '';
  const isBidc = (lv as string) === 'Bi-District' || (lv as string) === 'BIDC';

  // Bag-level fallbacks (unreachable inline `|| '___'` below, as in v12).
  const hv = id.hostVenueName || '[Venue TBD]';
  const hsName = id.hostSchoolName || '[Host School]';
  const hsAddr = id.hostAddress || '[Address TBD]';
  const dm = d.directorsMeetingTime || 'TBD';
  const tech = contest.cmInfo.techContact || '[Host Technical Director]';
  // Fields with no bag-level fallback — these DO fall through to "___".
  const cdDisplay = fmtDate(d.contestDate);
  const fs = d.firstShowTime || '';

  const schools = docSchools(contest);

  const parts = [
    ooP((yr ? yr + ' ' : '') + cls + ' ' + lv + ' OAP Planning Meeting Agenda', { bold: true, size: 26, color: '1F4E79', align: 'center', sb: 0, sa: 60 }),
    ooP('UIL One-Act Play Contest', { size: 20, color: '555555', align: 'center', sa: 40 }),
    ooP('Date: ___________________________     Location: ___________________________', { size: 18, color: '555555', align: 'center', sa: 180 }),
    ooPLine('2E75B6'),
    ooPEmpty(40),
    ooP('UIL requires the Planning Meeting be held between August 10 and November 1.', { size: 18, color: 'C00000', italic: true, sa: 160 }),

    ooPHead('1. Call to Order & Introductions'),
    ooPBullet('Contest Manager introduces themselves and welcomes directors.'),
    ooPBullet('Directors introduce themselves and their schools.'),
    ooPEmpty(80),

    ooPHead('2. Confirm Contest Site'),
    ooPBullet('Stage, dressing rooms, judge room, and hospitality room confirmed and reserved.'),
    ooTable2Col([
      ['Venue:', hv || '___________________________'],
      ['Host School:', hsName || '___________________________'],
      ['Address:', hsAddr || '___________________________'],
    ]),
    ooPEmpty(80),

    ooPHead('3. Set Contest Date & Time'),
    ooPBullet('Verify selected date against UIL Official Calendar — confirm no conflicts.'),
    ooTable2Col([
      ['Contest Date:', cdDisplay || '___________________________'],
      ["Directors' Meeting:", dm || '___________________________'],
      ['First Performance:', fs || '___________________________'],
    ]),
    ooPEmpty(80),

    ooPHead('4. Performance Order Draw'),
    ooP('Blind draw is required annually at all levels and must be conducted at this meeting.', { size: 20, sa: 80 }),
    ooP('Registered schools:', { size: 20, sa: 40 }),
    ...schools.map((s) => ooP('•  ' + s.name, { size: 20, indent: 360, sa: 30 })),
    ooPEmpty(60),
    ooP('Performance order results (fill in after draw):', { size: 20, sa: 40 }),
    ...schools.map((_, i) => ooP((i + 1) + '.  ___________________________________', { size: 20, indent: 360, sa: 40 })),
    ooPEmpty(80),

    ooPHead('5. Contest Site — Local Rules & Logistics'),
    ooPBullet('Review local rules for the contest site with host school technical director.'),
    ooPBullet('Send list of needed personnel / site crew roles to host school.'),
    ooP('Technical Contact: ' + (tech || '___________________________________'), { size: 20, indent: 360, sa: 80 }),
    ooPEmpty(80),

    ooPHead('6. District Contact List'),
    ooP('Confirm or create district contact list with all director names and email addresses.', { size: 20, sa: 60 }),
    ...schools.map((s) => ooP(s.name + '  —  ' + (s.director || '[Director]') + '  —  ' + (s.email || '[email]'), { size: 18, indent: 360, sa: 30 })),
    ooPEmpty(80),

    ooPHead('7. Light Cue Deadline'),
    ooPBullet('Verify the light cue deadline with the host school for pre-programming.'),
    ooP('Light Cue Deadline: _____________________________   at   ____________', { size: 20, indent: 360, sa: 80 }),
    ooPEmpty(80),

    ...(isBidc
      ? [
          ooPHead('8. BIDC Registration'),
          ooPBullet('Register meet on UIL Bi-District online form (deadline: August 31).'),
          ooPEmpty(80),
        ]
      : []),

    ooPHead(isBidc ? '9. Other Business & Adjournment' : '8. Other Business & Adjournment'),
    ooP('_______________________________________________________________', { size: 20, sa: 40 }),
    ooP('_______________________________________________________________', { size: 20, sa: 40 }),
    ooP('_______________________________________________________________', { size: 20, sa: 80 }),
    ooP('Next communication: ___________________________', { size: 20, sa: 60 }),
    ooP('Meeting adjourned at: ___________________________', { size: 20, sa: 0 }),
  ];
  return await makeDocx(parts.filter(Boolean).join(''));
}
