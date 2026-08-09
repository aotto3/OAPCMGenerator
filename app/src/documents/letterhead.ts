/**
 * Shared letterhead + signature emitters for the letter-family .docx documents
 * (the Director Information Letter and the Advancing Schools Letter).
 *
 * Both letters open with a byte-identical letterhead (CM name in large blue, the
 * "UIL One-Act Play Contest Manager" line, email, phone, a divider rule, spacing,
 * and the date) and close with a signature block whose first six paragraphs are
 * identical ("Play with Love,", the signed name, title, phone, email, mailing
 * address). Those shared runs live here so the two letters stop duplicating them;
 * each letter still appends its own divergent closing tail (website / contest-site
 * lines) inline.
 *
 * Emitters return ARRAYS of paragraph XML, spread into each letter's `parts`, so
 * each letter's own `.join()` separator still applies verbatim (letter.ts joins
 * with '\n', advancingLetter.ts with '') — the output stays byte-for-byte
 * identical to the inlined version, which the golden files lock.
 *
 * Pure OOXML: reads the DocCmInfo projection (documents/docVars.ts), emits strings
 * via ooxml.ts. No model dependency beyond the projection.
 */
import type { DocCmInfo } from './docVars';
import { ooP, ooPEmpty, ooPLine } from './ooxml';

/**
 * The shared letterhead: name (26 half-pt, blue), the CM-Manager subtitle, email,
 * phone, a blue divider, spacing, and the letter date. `today` is the
 * pre-formatted date string (each letter injects its own, from `options.now`, for
 * golden stability).
 */
export function letterhead(cm: DocCmInfo, today: string): string[] {
  return [
    ooP(cm.name, { bold: true, size: 26, color: '1F4E79', sb: 0, sa: 40 }),
    ooP('UIL One-Act Play Contest Manager', { size: 18, color: '555555', sa: 20 }),
    cm.email ? ooP(cm.email, { size: 18, color: '2E75B6', sa: 20 }) : '',
    cm.phone ? ooP(cm.phone, { size: 18, color: '555555', sa: 20 }) : '',
    ooPLine('2E75B6'),
    ooPEmpty(160),
    ooP(today, { size: 20, sa: 200 }),
  ];
}

/**
 * The shared signature block: the sign-off, the signed name ("<name>, J.D."), the
 * CM-Manager subtitle, phone, email, and mailing address. Callers append their own
 * closing tail (e.g. a website line and the contest-site lines) after this.
 */
export function signatureBlock(cm: DocCmInfo): string[] {
  return [
    ooP('Play with Love,', { size: 20, sa: 360 }),
    ooP(cm.name + ', J.D.', { bold: true, size: 20, sa: 40 }),
    ooP('UIL One-Act Play Contest Manager', { size: 18, color: '555555', sa: 20 }),
    cm.phone ? ooP(cm.phone, { size: 18, color: '555555', sa: 20 }) : '',
    cm.email ? ooP(cm.email, { size: 18, color: '2E75B6', sa: 20 }) : '',
    cm.mailingAddress ? ooP(cm.mailingAddress, { size: 18, color: '555555', sa: 20 }) : '',
  ];
}
