/**
 * Adjudicator Information Sheet (.xlsx).
 *
 * Ported from v12 genAdjudicatorInfo (_Templates/OAP Contest Setup.html, ~lines
 * 2149–2179). A plain (unstyled) label/value grid: contest details, the judge
 * panel (name + script-mailing address, with per-judge power/hotel/dietary
 * notes), and CM contact block. Reproduces v12's fallback strings exactly ('TBA'
 * judge names, 'Address TBA' addresses, the host/venue/address placeholders).
 *
 * Pure: no DOM. Synchronous — XLSX.write packs the workbook directly.
 */

import * as XLSX from 'xlsx-js-style';
import { adjudicatorMilestoneStatus, contestTitleLong, type Contest } from '../model/contest';
import { fmtDate } from './format';
import { xlsxBuf } from './xlsx';

export function buildAdjudicatorInfo(contest: Contest): Uint8Array {
  const id = contest.identity;
  const d = contest.details;
  const cm = contest.cmInfo;

  const panelRows: string[][] = [];
  for (let i = 1; i <= d.numJudges; i++) {
    const j = contest.adjudicators[i - 1];
    panelRows.push(['Judge ' + i, (j && j.name) || 'TBA', (j && j.mailingAddress) || 'Address TBA']);
    const extras: string[] = [];
    if (j && j.needsPower) extras.push('Needs power at table');
    if (j && j.needsHotel) extras.push('Hotel: ' + j.hotelNights + ' night(s)');
    if (j && j.dietary) extras.push('Dietary/Other: ' + j.dietary);
    if (extras.length) panelRows.push(['', extras.join('  |  '), '']);
    // Contracting milestones (PRD #67), a snapshot as of generation: a completed
    // one shows a check + its stored date, a pending one shows 'pending'. Renders
    // from the shared derivation so labels/order match the Judges UI exactly.
    if (j) {
      adjudicatorMilestoneStatus(j).forEach((m, mi) => {
        const text = m.done ? '✓ ' + m.label + ': ' + fmtDate(m.date) : m.label + ': pending';
        panelRows.push([mi === 0 ? 'Contracting' : '', text, '']);
      });
    }
  }

  const cmName = cm.name || 'Allen Otto';
  const cmEmail = cm.email || 'aotto3@gmail.com';

  const rows: string[][] = [
    [contestTitleLong(id)],
    ['Adjudicator Information Sheet'],
    [],
    ['CONTEST DETAILS'],
    ['Date', fmtDate(d.contestDate) || 'TBD'],
    ['Location', (id.hostVenueName || '[Venue TBD]') + ' — ' + (id.hostSchoolName || '[Host School]')],
    ['Address', id.hostAddress || '[Address TBD]'],
    ['Directors Meeting', d.directorsMeetingTime || 'TBD'],
    ['First Performance', d.firstShowTime || 'TBD'],
    ['Critique Format', d.critiqueFormat === 'after_each' ? 'After each performance' : 'After all performances'],
    [],
    ['ADJUDICATOR PANEL'],
    ['', 'Name', 'Mailing Address (scripts sent here)'],
    ...panelRows,
    [],
    ['CONTEST MANAGER'],
    ['Name', cmName],
    ['Email', cmEmail || ''],
    ['Phone', cm.phone || ''],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 20 }, { wch: 32 }, { wch: 50 }];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Adjudicator Info');
  return xlsxBuf(wb);
}
