/**
 * School–Director Contact List (.xlsx).
 *
 * Ported from v12 genContactList (_Templates/OAP Contest Setup.html, ~lines
 * 2121–2143). A plain (unstyled) value grid: one row per school in performance
 * order — order, school, first director + email, additional directors, play —
 * then the CM contact row and a copyable all-director email list. All schools
 * and the email list are in PERFORMANCE order (v12 read _readSchools, which
 * sorts), NOT form order — so this deliberately does not reuse the model's
 * form-order allDirectorEmails().
 *
 * Pure: no DOM. Synchronous — XLSX.write packs the workbook directly.
 */

import * as XLSX from 'xlsx-js-style';
import { contestTitleLong, schoolsInPerformanceOrder, type Contest } from '../model/contest';
import { docSchools } from './docVars';
import { xlsxBuf } from './xlsx';

export function buildContactList(contest: Contest): Uint8Array {
  const cm = contest.cmInfo;
  const cmName = cm.name || 'Allen Otto';
  const cmEmail = cm.email || 'aotto3@gmail.com';
  const cmPhone = cm.phone || '';

  // Same performance order; docSchools supplies v12's name/play fallbacks, the
  // raw sorted list supplies the full director array for the "additional" column.
  const sorted = schoolsInPerformanceOrder(contest);
  const docS = docSchools(contest);

  const rows: (string | number)[][] = [
    [contestTitleLong(contest.identity)],
    ['School & Director Contact List'],
    [],
    ['Order', 'School Name', 'Director', 'Email', 'Additional Directors', 'Play Title'],
  ];
  sorted.forEach((s, i) => {
    const ds = docS[i];
    const addl = s.directors
      .slice(1)
      .map((d) => d.name + (d.email ? ' <' + d.email + '>' : ''))
      .join('; ');
    rows.push([ds.order, ds.name, ds.director, ds.email, addl, ds.play]);
  });
  rows.push([]);
  rows.push(['Contest Manager:', cmName, cmEmail, cmPhone, '', '']);
  rows.push([]);
  rows.push(['All-Director Email List (Gmail — paste into To: field):', '', '', '', '', '']);
  const allEmails = sorted
    .flatMap((s) => s.directors.map((d) => d.email).filter(Boolean))
    .join(', ');
  rows.push([allEmails, '', '', '', '', '']);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 8 }, { wch: 36 }, { wch: 26 }, { wch: 34 }, { wch: 40 }, { wch: 40 }];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Contact List');
  return xlsxBuf(wb);
}
