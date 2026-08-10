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

import { contestTitleLong, schoolsInPerformanceOrder, type Contest } from '../model/contest';
import { docCmInfo, docSchools } from './docVars';
import { makeSheet } from './xlsx';

export function buildContactList(contest: Contest): Uint8Array {
  const { name: cmName, email: cmEmail, phone: cmPhone } = docCmInfo(contest);

  // Same performance order; docSchools supplies v12's name/play fallbacks, the
  // raw sorted list supplies the full director array for the "additional" column.
  const sorted = schoolsInPerformanceOrder(contest);
  const docS = docSchools(contest);

  const sheet = makeSheet()
    .row([contestTitleLong(contest.identity)])
    .row(['School & Director Contact List'])
    .blank()
    .row(['Order', 'School Name', 'Director', 'Email', 'Additional Directors', 'Play Title']);
  sorted.forEach((s, i) => {
    const ds = docS[i];
    const addl = s.directors
      .slice(1)
      .map((d) => d.name + (d.email ? ' <' + d.email + '>' : ''))
      .join('; ');
    sheet.row([ds.order, ds.name, ds.director, ds.email, addl, ds.play]);
  });
  const allEmails = sorted
    .flatMap((s) => s.directors.map((d) => d.email).filter(Boolean))
    .join(', ');
  sheet
    .blank()
    .row(['Contest Manager:', cmName, cmEmail, cmPhone, '', ''])
    .blank()
    .row(['All-Director Email List (Gmail — paste into To: field):', '', '', '', '', ''])
    .row([allEmails, '', '', '', '', '']);

  return sheet
    .cols([8, 36, 26, 34, 40, 40])
    .merge({ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } })
    .merge({ s: { r: 1, c: 0 }, e: { r: 1, c: 5 } })
    .buffer('Contact List');
}
