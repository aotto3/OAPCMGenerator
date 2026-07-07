/**
 * Timer Instructions + Form (.docx).
 *
 * Ported from v12 genTimerDoc + its local ooTimerTable helper
 * (_Templates/OAP Contest Setup.html, lines ~2558–2668). Two pages: fixed
 * timekeeper instructions/script, a page break, then a per-show timing form.
 *
 * ooTimerTable emits a 5-column show/school/performance/setup/strike grid with a
 * spanned "Opening Cue" row under each show. It is genuinely document-specific
 * markup (only this document uses it), so — per the slice's helper policy — it
 * stays local here rather than in the shared ooxml.ts. If a later slice needs the
 * same grid, lift it then.
 *
 * Pure except makeDocx (JSZip). No "today" is stamped, so no ctx is needed.
 */

import { contestTitleLong, type Contest } from '../model/contest';
import { fmtDate } from './format';
import { docSchools, type DocSchool } from './docVars';
import { makeDocx, ooP, ooPEmpty, ooPHead, ooPLine, ooPPageBreak, ooTable2Col, xe } from './ooxml';

/** The per-show timing grid (v12 ooTimerTable). Local: only the timer form uses it. */
function ooTimerTable(schools: DocSchool[]): string {
  const W = [900, 3048, 1425, 1425, 1425];
  const totalW = W.reduce((a, b) => a + b, 0);
  const hdrs = ['SHOW', 'SCHOOL', 'PERFORMANCE', 'SETUP', 'STRIKE'];
  function tcell(text: string, bold: boolean, shade: boolean, w: number, center: boolean): string {
    const shd = shade ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E1F2"/>' : '';
    const b = bold ? '<w:b/><w:bCs/>' : '';
    const jc = center ? '<w:jc w:val="center"/>' : '';
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + shd +
      '<w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/>' +
      '<w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>' +
      '<w:p><w:pPr>' + jc + '<w:spacing w:before="40" w:after="40"/></w:pPr>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>' + b +
      '<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>' +
      '<w:t xml:space="preserve">' + xe(text) + '</w:t></w:r></w:p></w:tc>';
  }
  const bdr = '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="6" w:space="0" w:color="333333"/>' +
    '<w:left w:val="single" w:sz="6" w:space="0" w:color="333333"/>' +
    '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="333333"/>' +
    '<w:right w:val="single" w:sz="6" w:space="0" w:color="333333"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/>' +
    '</w:tblBorders>';
  const hdrRow = '<w:tr>' + hdrs.map((h, i) => tcell(h, true, true, W[i], true)).join('') + '</w:tr>';
  const cueW = W[1] + W[2] + W[3] + W[4];
  function tcellSpan(text: string, w: number, span: number): string {
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/><w:gridSpan w:val="' + span + '"/>' +
      '<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/>' +
      '<w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>' +
      '<w:p><w:pPr><w:spacing w:before="30" w:after="30"/></w:pPr>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>' +
      '<w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="555555"/><w:i/></w:rPr>' +
      '<w:t xml:space="preserve">' + xe(text) + '</w:t></w:r></w:p></w:tc>';
  }
  const dataRows = schools.flatMap((s, idx) => [
    '<w:tr>' +
      tcell('SHOW ' + (idx + 1), false, false, W[0], true) +
      tcell(s.name + (s.play ? ' — ' + s.play : ''), false, false, W[1], false) +
      tcell('', false, false, W[2], true) +
      tcell('', false, false, W[3], true) +
      tcell('', false, false, W[4], true) +
      '</w:tr>',
    '<w:tr>' +
      tcell('', false, false, W[0], true) +
      tcellSpan('Opening Cue:   ○ Lights     ○ Sound     ○ Both', cueW, 4) +
      '</w:tr>',
  ]).join('');
  return '<w:tbl><w:tblPr><w:tblW w:w="' + totalW + '" w:type="dxa"/>' + bdr + '</w:tblPr>' +
    '<w:tblGrid>' + W.map((w) => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>' +
    hdrRow + dataRows + '</w:tbl>';
}

/** Builds the Timer Instructions + Form. The registry's `timer` entry delegates here. */
export async function buildTimerDoc(contest: Contest): Promise<Uint8Array> {
  const id = contest.identity;
  const cls = id.classification || '';
  const lv = id.contestLevel || 'District';
  const contestDateDisplay = fmtDate(contest.details.contestDate);
  const schools = docSchools(contest);

  const instrParts = [
    ooP('UIL One-Act Play Timekeeper Instructions', { bold: true, size: 24, color: '1F4E79', align: 'center', sb: 0, sa: 60 }),
    ooP(contestTitleLong(id), { size: 18, color: '555555', align: 'center', sa: 160 }),
    ooPLine('2E75B6'),
    ooPEmpty(80),

    ooPHead('Pre-Contest Duties'),
    ooP('Consult with Contest Manager.', { size: 20, sa: 40 }),
    ooP('•  Check out stop watches from Contest Manager to become completely familiar with their operation. (i.e. — start and stop, change batteries or wind them)', { size: 20, indent: 360, sa: 0 }),
    ooP('•  Find out where you will be stationed.', { size: 20, indent: 360, sa: 0 }),
    ooP('•  Get Timekeeper Forms.', { size: 20, indent: 360, sa: 0 }),
    ooP('•  Get a copy of the opening and closing cue descriptions.', { size: 20, indent: 360, sa: 80 }),

    ooPHead('Contest Duties'),
    ooP('•  Time begins at the first visual or aural indication a show is beginning. Example: sound cue, dialogue, lights on action or scenery.', { size: 20, indent: 360, sa: 0 }),
    ooP('•  If there is a possible time infraction, the Contest Manager must be advised immediately.', { size: 20, indent: 360, sa: 80 }),
    ooP('DO NOT CLEAR WATCHES UNTIL THE CONTEST MANAGER AND THE COMPANY’S DIRECTOR HAVE SEEN THEM', { bold: true, size: 20, align: 'center', sa: 0 }),
    ooP('Do not discuss a school’s time with anyone.', { bold: true, size: 20, align: 'center', sa: 0 }),
    ooP('At the end of the day, return your stop watches, forms, and flashlights.', { size: 20, sa: 120 }),

    ooPHead('Timekeeper Script'),
    ooP('⚠️ THIS SECTION IS FOR THE BACKSTAGE TIMEKEEPER ONLY', { bold: true, size: 20, color: 'C00000', align: 'center', sa: 40 }),
    ooP('Please use this language for the time warnings:', { size: 20, sa: 40 }),
    ooP('“You are at 35 minutes … (When stopwatch hits 35 minutes) … now. Please confirm.”', { size: 20, indent: 360, sa: 0 }),
    ooP('“You are at 15 minutes … (When stopwatch hits 15 minutes) … now. Please confirm.”', { size: 20, indent: 360, sa: 0 }),
    ooP('“You are at 4 minutes … (When stopwatch hits 4 minutes) … now. Please confirm.”', { size: 20, indent: 360, sa: 0 }),
    ooP('“You are at 3 minutes … (When stopwatch hits 3 minutes) … now. Please confirm.”', { size: 20, indent: 360, sa: 0 }),
    ooP('“You are at 2 minutes … (When stopwatch hits 2 minutes) … now. Please confirm.”', { size: 20, indent: 360, sa: 0 }),
    ooP('“You are at 1 minute … (When stopwatch hits 1 minute) … now. Please confirm.”', { size: 20, indent: 360, sa: 0 }),
    ooP('“You are at 30 seconds … (When stopwatch hits 30 seconds) … now. Please confirm.”', { size: 20, indent: 360, sa: 0 }),
    ooP('“You are at 15 seconds … (When stopwatch hits 15 seconds) … now. Please confirm.”', { size: 20, indent: 360, sa: 80 }),

    ooPHead('Time Warnings Reference'),
    ooTable2Col([
      ['7 Min. / per school', 'Setup & Strike — 5 min to 15 sec audible warning'],
      ['1 Minute', 'Time allowed to start performance after setup ends — 60 sec to 10 sec audible warning'],
      ['18–40 Minutes', 'Performance Time — warnings at 35 & 15 min, then 4, 3, 2, 1 min, 30 sec, 15 sec'],
    ]),
    ooPPageBreak(),
  ];
  const formParts = [
    ooP('UIL One-Act Play Timer Form', { bold: true, size: 24, color: '1F4E79', align: 'center', sb: 0, sa: 60 }),
    ooTable2Col([
      ['Conference:', cls],
      ['Level:', lv],
      ['Contest Date:', contestDateDisplay || 'TBD'],
    ]),
    ooPEmpty(80),
    ooTimerTable(schools),
    ooPEmpty(80),
    ooP('Timekeeper Name (Print): ________________________________', { size: 18, sa: 60 }),
    ooP('Timekeeper Signature: ___________________________________     Date: ___________', { size: 18, sa: 80 }),
    ooPEmpty(60),
    ooP('DO NOT CLEAR WATCHES UNTIL THE CONTEST MANAGER AND THE DIRECTOR HAVE SEEN THEM. Do not discuss times with anyone.', { bold: true, size: 18, sa: 0 }),
  ];
  return await makeDocx([...instrParts, ...formParts].filter(Boolean).join(''));
}
