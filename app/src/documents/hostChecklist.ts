/**
 * Host School Checklist (.docx).
 *
 * Ported from v12 genHostChecklist (_Templates/OAP Contest Setup.html, lines
 * ~2754–2838). A fixed checklist of the host school's responsibilities, keyed to
 * the number of schools (dressing rooms / storage boxes) and the admission fee.
 *
 * v12 FALLBACK FIDELITY: v12's `vars` bag pre-baked "[Venue TBD]" for a blank
 * venue and "[Host Technical Director]" for a blank tech contact, so this
 * generator's inline `|| '[Venue]'` / `|| '[Technical Director]'` fallbacks were
 * unreachable. The bag values are reproduced (a blank venue prints "[Venue TBD]").
 *
 * Pure except makeDocx (JSZip). No "today" is stamped, so no ctx is needed.
 */

import { contestTitleLong, type Contest } from '../model/contest';
import { fmtDate } from './format';
import { makeDocx, ooP, ooPBullet, ooPEmpty, ooPHead, ooPLine } from './ooxml';

/** Builds the Host School Checklist. The registry's `host_checklist` entry delegates here. */
export async function buildHostChecklist(contest: Contest): Promise<Uint8Array> {
  const id = contest.identity;
  const cm = contest.cmInfo;
  const d = contest.details;

  const hs = id.hostSchoolName || '[Host School]';
  const hv = id.hostVenueName || '[Venue TBD]';
  const cd = fmtDate(d.contestDate) || 'TBD';
  const tech = cm.techContact || '[Host Technical Director]';
  const af = d.admissionFee ? '$' + d.admissionFee : null;
  const numSchools = contest.schools.length;

  const cmName = cm.name || 'Allen Otto';
  const cmEmail = cm.email || 'aotto3@gmail.com';
  const cmPhone = cm.phone || '';

  const parts = [
    ooP(contestTitleLong(id), { bold: true, size: 26, color: '1F4E79', align: 'center', sb: 0, sa: 40 }),
    ooP('Host School Checklist', { size: 20, color: '555555', align: 'center', sa: 40 }),
    ooP(hs + ' • ' + hv + ' • ' + cd, { size: 18, color: '888888', align: 'center', sa: 120 }),
    ooPLine('2E75B6'),
    ooPEmpty(80),

    ooP('This checklist covers the responsibilities of the host school. The Contest Manager handles all administrative and UIL-specific duties. Coordinate directly with ' + cmName + ' at ' + cmEmail + '.', { size: 20, color: '555555', sa: 120 }),

    ooPHead('Technical Director'),
    ooP('Primary Technical Contact: ' + tech, { size: 20, sa: 40 }),
    ooPBullet('Confirm technical director will be present for all rehearsals and contest day.'),
    ooPBullet('Coordinate with each school’s tech crew during their assigned rehearsal time.'),
    ooPBullet('Be available for light board pre-programming prior to rehearsals (see light cue deadline in director letter).'),
    ooPEmpty(80),

    ooPHead('Facility Preparation (Before Contest Day)'),
    ooPBullet('Reserve stage, wings, and loading dock for all rehearsal and contest dates.'),
    ooPBullet('Reserve one classroom per school as dressing room — ' + numSchools + ' total.'),
    ooPBullet('Reserve a private, quiet room for the adjudicator panel (table, chairs, no traffic).'),
    ooPBullet('Reserve hospitality room for CM and staff.'),
    ooPBullet('Confirm parking plan for school buses and vans at loading dock.'),
    ooPBullet('Confirm box office location and staffing plan.'),
    ooPEmpty(80),

    ooPHead('Stage Setup'),
    ooPBullet('Unit set in place: door unit, window unit, French doors.'),
    ooPBullet('School set storage boxes staked/taped on stage — one per school (' + numSchools + ' total). Spike tape colors assigned by CM.'),
    ooPBullet('Backstage supplies: broom, trash cans, stage weights, backstage work lights.'),
    ooPBullet('Intercom/headset system tested and operational (backstage ↔ CM position).'),
    ooPBullet('8’ step ladder and stage weights available if needed.'),
    ooPEmpty(80),

    ooPHead('Technical Equipment'),
    ooPBullet('Light board pre-programmed with each school’s cues submitted before deadline.'),
    ooPBullet('House lights operational and tested.'),
    ooPBullet('Sound board tested — 3.5mm (aux) input available for school devices.'),
    ooPBullet('Pre-show announcement recorded and queued.'),
    ooPBullet('All stage lighting instruments confirmed working.'),
    ooPEmpty(80),

    ooPHead('Dressing Rooms (' + numSchools + ' Classrooms)'),
    ooPBullet('One classroom per school — confirm assignments with CM.'),
    ooPBullet('Rooms unlocked and accessible throughout the full contest day.'),
    ooPBullet('Trash cans in each room.'),
    ooP('⚠️  Mirrors are NOT guaranteed — schools are notified to bring their own.', { bold: true, size: 18, color: 'C00000', indent: 360, sa: 40 }),
    ooPBullet('Rooms must be returned to original condition (desks, chairs, décor in place).'),
    ooPEmpty(80),

    ooPHead('Box Office'),
    af
      ? ooP('Admission: ' + af + ' per person (all-day pass). Collect from all attendees not listed on UIL enrollment as cast, crew, alternate, or director. High school administrators are subject to the charge.', { size: 20, sa: 80 })
      : ooP('Admission policy: confirm with CM.', { size: 20, color: '888888', sa: 80 }),
    ooPBullet('Staff the box office for the full contest day.'),
    ooPBullet('Audience members pay once and may attend all shows.'),
    ooPEmpty(80),

    ooPHead('Loading Dock & Parking'),
    ooPBullet('Loading dock accessible, clearly signed, and supervised during load-in periods.'),
    ooPBullet('Covered unloading area available — do not block any loading bay doors.'),
    ooPBullet('Back parking lot available for school vehicles after unloading.'),
    ooPBullet('Confirm school load-in schedule with CM.'),
    ooPEmpty(80),

    ooPHead('Contest Day'),
    ooPBullet('Technical director and crew on site before first school load-in.'),
    ooPBullet('All rooms unlocked and ready. Box office staffed and open.'),
    ooPBullet('Do not clear school materials from stage between shows without CM direction.'),
    ooPEmpty(80),

    ooPHead('Post-Contest'),
    ooPBullet('All companies must fully strike and clear the stage before awards ceremony.'),
    ooPBullet('Confirm dressing rooms are cleared and returned to original condition.'),
    ooPBullet('Stage restored and facility secured after awards ceremony.'),
    ooPEmpty(80),

    ooP('Questions? Contact: ' + cmName + (cmPhone ? ' • ' + cmPhone : '') + (cmEmail ? ' • ' + cmEmail : ''), { size: 18, color: '555555', align: 'center', sa: 0 }),
  ];
  return await makeDocx(parts.filter(Boolean).join(''));
}
