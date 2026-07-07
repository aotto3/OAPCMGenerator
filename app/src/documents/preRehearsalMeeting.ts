/**
 * Pre-Rehearsal Company Meeting (.docx).
 *
 * Ported from v12 genPreRehearsalMeeting (_Templates/OAP Contest Setup.html,
 * lines ~2900–3097). A single-page company briefing with a tight, hand-tuned
 * layout: mixed bold/size runs and soft line breaks inside paragraphs, plus a
 * 4-column school table (spike tape / upstage curtain / strike lead).
 *
 * v12 built this document with its OWN inline run-property (`rp`) and
 * paragraph-property (`pp`) helpers instead of the shared ooP/ooTable2Col,
 * because it needs run-level control the shared helpers do not expose. Those
 * helpers, and the bespoke table, are genuinely document-specific — only this
 * document uses them — so they stay local here (per the slice's helper policy).
 *
 * The only contest inputs are the title, rehearsal length, and the schools list.
 * Pure except makeDocx (JSZip). No "today" is stamped, so no ctx is needed.
 */

import { contestTitleLong, type Contest } from '../model/contest';
import { docSchools } from './docVars';
import { makeDocx, xe } from './ooxml';

/** Builds the Pre-Rehearsal Company Meeting. The registry's `pre_rehearsal_meeting` entry delegates here. */
export async function buildPreRehearsalMeeting(contest: Contest): Promise<Uint8Array> {
  const titleLong = contestTitleLong(contest.identity);
  const mins = contest.details.rehearsalLengthMinutes || 90;
  const rehDisplay = mins >= 60
    ? (mins % 60 === 0
        ? (mins / 60) + ' hour' + (mins / 60 !== 1 ? 's' : '')
        : Math.floor(mins / 60) + ' hr ' + (mins % 60) + ' min')
    : mins + ' min';

  // ── Inline run-props helper ──────────────────────────────────
  function rp(sz: number, bold: boolean): string {
    return '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>' +
      (bold ? '<w:b/><w:bCs/>' : '') +
      '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
  }
  // Paragraph props: line=240/auto, optional indent, optional before/after override
  function pp(sa?: number, sb?: number, indent?: number): string {
    const i = indent ? '<w:ind w:left="' + indent + '"/>' : '';
    return '<w:pPr><w:spacing w:before="' + (sb || 0) + '" w:after="' + (sa || 0) + '" w:line="240" w:lineRule="auto"/>' + i + '</w:pPr>';
  }

  // Para 0: contest title — centered, bold 13pt, after=20
  const p0 = '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="20"/></w:pPr>' +
    '<w:r>' + rp(26, true) + '<w:t xml:space="preserve">' + xe(titleLong || '') + '</w:t></w:r>' +
    '</w:p>';

  // Para 1: "Pre-Rehearsal Company Meeting" — centered, bold 11pt, after=20
  const p1 = '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="20"/></w:pPr>' +
    '<w:r>' + rp(22, true) + '<w:t>Pre-Rehearsal Company Meeting</w:t></w:r>' +
    '</w:p>';

  // Para 2: soft break + "Introduction -" bold 11pt + body 9pt (all in one para), after=40
  const p2 = '<w:p><w:pPr><w:spacing w:before="0" w:after="40"/></w:pPr>' +
    '<w:r>' + rp(18, false) + '<w:br/></w:r>' +
    '<w:r>' + rp(22, true) + '<w:t>Introduction</w:t></w:r>' +
    '<w:r>' + rp(22, true) + '<w:t xml:space="preserve"> -</w:t></w:r>' +
    '<w:r>' + rp(18, false) + '<w:t xml:space="preserve"> </w:t></w:r>' +
    '<w:r>' + rp(18, false) + '<w:t xml:space="preserve">This is your rehearsal period — you will have ' + xe(rehDisplay) + ', including strike.  Directors — forms at your leisure.</w:t></w:r>' +
    '</w:p>';

  // Para 3: "Stage Manager - Backstage Manager: ___" — mixed bold 11pt / plain 10pt, after=0
  const p3 = '<w:p>' + pp(0) +
    '<w:r>' + rp(22, true) + '<w:t>Stage Manager</w:t></w:r>' +
    '<w:r>' + rp(22, true) + '<w:t xml:space="preserve"> - </w:t></w:r>' +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Backstage Manager: _________________________________</w:t></w:r>' +
    '</w:p>';

  // Para 4: indented timing line with soft break at end, 10pt
  const p4 = '<w:p>' + pp(0, 0, 360) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Indicates and acknowledges timing: Setup · Strike · Show Run</w:t></w:r>' +
    '<w:r>' + rp(20, false) + '<w:br/></w:r>' +
    '</w:p>';

  // Para 5: "Lights / Sound" — bold 11pt
  const p5 = '<w:p>' + pp(0) +
    '<w:r>' + rp(22, true) + '<w:t>Lights / Sound</w:t></w:r>' +
    '</w:p>';

  // Para 6: fill-in blanks line, 10pt
  const p6 = '<w:p>' + pp(0) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">___________________________ and/or ___________________________ will help during rehearsal but will NOT run your lights — be familiar with everything!</w:t></w:r>' +
    '</w:p>';

  // Para 7: Sound Operator fill-in, 10pt
  const p7 = '<w:p>' + pp(0) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Sound Operator: ___________________________</w:t></w:r>' +
    '</w:p>';

  // Para 8: soft break + "Curtains" — bold 11pt
  const p8 = '<w:p>' + pp(0) +
    '<w:r>' + rp(22, true) + '<w:br/></w:r>' +
    '<w:r>' + rp(22, true) + '<w:t>Curtains</w:t></w:r>' +
    '</w:p>';

  // Para 9: Pros. Curtain fill-in, 10pt
  const p9 = '<w:p>' + pp(0) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Pros. Curtain: ______________________ throughout set-up and strike.</w:t></w:r>' +
    '</w:p>';

  // Para 10: Fly Rail fill-in, 10pt
  const p10 = '<w:p>' + pp(0) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Fly Rail: ___________________________</w:t></w:r>' +
    '</w:p>';

  // Para 11: indented "Back curtain must be set during Set Up.", 10pt
  const p11 = '<w:p>' + pp(0, 0, 360) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Back curtain must be set during Set Up.</w:t></w:r>' +
    '</w:p>';

  // Para 12: indented "Strike unit set to the side — move your materials...", 10pt
  const p12 = '<w:p>' + pp(0, 0, 360) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Strike unit set to the side — move your materials to your assigned position.</w:t></w:r>' +
    '</w:p>';

  // ── 4-column school table ──────────────────────────────────────
  const COL = [2600, 2000, 2200, 2200];
  const TCMAR = '<w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>';
  const TBLBRD = '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>' +
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>' +
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="DDDDDD"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="DDDDDD"/>' +
    '</w:tblBorders>';
  const CELLPP = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>';
  function mkHdrCell(text: string, w: number): string {
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' +
      '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/>' + TCMAR + '</w:tcPr>' +
      '<w:p>' + CELLPP + '<w:r>' + rp(16, true) + '<w:t xml:space="preserve">' + xe(text) + '</w:t></w:r></w:p></w:tc>';
  }
  function mkDataCell(text: string, w: number, bold: boolean): string {
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + TCMAR + '</w:tcPr>' +
      '<w:p>' + CELLPP + '<w:r>' + rp(16, bold) + '<w:t xml:space="preserve">' + xe(text) + '</w:t></w:r></w:p></w:tc>';
  }
  function mkCurtainCell(w: number): string {
    const r = rp(16, false);
    const c1 = '<w:p>' + CELLPP + '<w:r>' + r + '<w:t>☐ CYC</w:t></w:r></w:p>';
    const c2 = '<w:p>' + CELLPP + '<w:r>' + r + '<w:t>☐ Back Black</w:t></w:r></w:p>';
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + TCMAR + '</w:tcPr>' + c1 + c2 + '</w:tc>';
  }
  const hdrRow = '<w:tr>' +
    mkHdrCell('School', COL[0]) + mkHdrCell('Spike Tape', COL[1]) +
    mkHdrCell('Upstage Curtain', COL[2]) + mkHdrCell('Strike Lead', COL[3]) +
    '</w:tr>';
  const dataRows = docSchools(contest).map((s) => {
    const label = s.name + (s.play ? ' — ' + s.play : '');
    return '<w:tr>' +
      mkDataCell(label, COL[0], true) + mkDataCell('', COL[1], false) +
      mkCurtainCell(COL[2]) + mkDataCell('', COL[3], false) +
      '</w:tr>';
  }).join('');
  const schoolTable = '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>' + TBLBRD +
    '</w:tblPr><w:tblGrid>' + COL.map((w) => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>' +
    hdrRow + dataRows + '</w:tbl>';

  // Para 13: empty
  const p13 = '<w:p>' + pp(0) + '</w:p>';

  // Para 14: soft break + "Show Start Procedure" — bold 10pt, before=100, after=30
  const p14 = '<w:p><w:pPr><w:spacing w:before="100" w:after="30"/></w:pPr>' +
    '<w:r>' + rp(20, true) + '<w:br/></w:r>' +
    '<w:r>' + rp(20, true) + '<w:t>Show Start Procedure</w:t></w:r>' +
    '</w:p>';

  // Para 15: arrow flow — 9pt, after=40
  const p15 = '<w:p><w:pPr><w:spacing w:before="0" w:after="40"/></w:pPr>' +
    '<w:r>' + rp(18, false) + '<w:t xml:space="preserve">Setup  →  Leave stage / Announcement  →  1 minute  →  Show begins</w:t></w:r>' +
    '</w:p>';

  // Para 16: soft break + "After Your Show" — bold 11pt
  const p16 = '<w:p>' + pp(0) +
    '<w:r>' + rp(22, true) + '<w:br/></w:r>' +
    '<w:r>' + rp(22, true) + '<w:t>After Your Show</w:t></w:r>' +
    '</w:p>';

  // Para 17: indented "Load all the way out...", 10pt
  const p17 = '<w:p>' + pp(0, 0, 360) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Load all the way out into the loading dock.</w:t></w:r>' +
    '</w:p>';

  // Para 18: indented "Unit set — return to its designated position." + soft break, 10pt
  const p18 = '<w:p>' + pp(0, 0, 360) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Unit set — return to its designated position.</w:t></w:r>' +
    '<w:r>' + rp(20, false) + '<w:br/></w:r>' +
    '</w:p>';

  // Para 19: "Full Disclosure" — bold 11pt
  const p19 = '<w:p>' + pp(0) +
    '<w:r>' + rp(22, true) + '<w:t>Full Disclosure</w:t></w:r>' +
    '</w:p>';

  // Para 20: "Show me anything during rehearsal...", 10pt
  const p20 = '<w:p>' + pp(0) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">Show me anything during rehearsal that needs to be approved before the contest.</w:t></w:r>' +
    '</w:p>';

  // Para 21: "No tobacco, no alcohol, no firearms on the premises.", 10pt
  const p21 = '<w:p>' + pp(0) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">No tobacco, no alcohol, no firearms on the premises.</w:t></w:r>' +
    '</w:p>';

  // Para 22: "No cell phones.", 10pt
  const p22 = '<w:p>' + pp(0) +
    '<w:r>' + rp(20, false) + '<w:t xml:space="preserve">No cell phones.</w:t></w:r>' +
    '</w:p>';

  // Para 23: empty
  const p23 = '<w:p>' + pp(0) + '</w:p>';

  // Para 24: "What questions do you have for me?" — bold 10pt
  const p24 = '<w:p>' + pp(0) +
    '<w:r>' + rp(20, true) + '<w:t xml:space="preserve">What questions do you have for me?</w:t></w:r>' +
    '</w:p>';

  const body = p0 + p1 + p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9 + p10 + p11 + p12 +
    schoolTable + p13 + p14 + p15 + p16 + p17 + p18 + p19 + p20 + p21 + p22 + p23 + p24;
  return await makeDocx(body);
}
