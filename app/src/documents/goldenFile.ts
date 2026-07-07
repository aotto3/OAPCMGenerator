/**
 * Golden-file harness for the document engine.
 *
 * TEST SUPPORT (Node): uses `node:fs`, so it is imported only by *.test.ts and
 * never bundled into the app. Every document generator (this slice's letter and
 * the ports in slices 7–9) is verified the same way — build the archive from a
 * fixture contest and compare it to an approved golden file on disk.
 *
 * WHY CONTENT-NORMALIZED, NOT RAW BYTES: a .docx/.xlsx is a ZIP, and JSZip
 * stamps each entry with the current time and may order entries differently run
 * to run. Comparing raw ZIP bytes would fail spuriously on those. Instead we
 * UNZIP both archives and compare each inner part as normalized text, keyed by
 * path — so entry order and timestamps are irrelevant and only the actual XML
 * (or other) content is asserted.
 *
 * REGENERATING A GOLDEN: run the suite with UPDATE_GOLDEN=1 (e.g.
 * `UPDATE_GOLDEN=1 npm test`). Missing goldens are always written on first run.
 * Review the resulting file in the diff before committing — that review is the
 * "approval". See app/src/documents/README.md.
 */

import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** True when the run should (re)write goldens instead of asserting against them. */
export const UPDATE_GOLDEN =
  process.env.UPDATE_GOLDEN === '1' || process.env.UPDATE_GOLDEN === 'true';

/**
 * Normalizes one inner XML/text part for comparison: normalize line endings and
 * break between adjacent tags so a per-line diff reads naturally. Applied
 * symmetrically to both sides, so it never hides a real content difference.
 */
function normalizePart(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/></g, '>\n<').trimEnd();
}

/** Unzips archive bytes into a map of entry path → normalized text (dirs dropped). */
export async function normalizeArchive(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = new Map<string, string>();
  const paths = Object.keys(zip.files)
    .filter((p) => !zip.files[p].dir)
    .sort();
  for (const p of paths) {
    parts.set(p, normalizePart(await zip.files[p].async('string')));
  }
  return parts;
}

export interface PartMismatch {
  part: string;
  kind: 'missing-from-actual' | 'unexpected-in-actual' | 'changed';
  /** Present for 'changed': a readable golden-vs-actual line diff. */
  diff?: string;
}

/**
 * Minimal readable diff of two normalized part strings: strips the common
 * leading/trailing lines and shows the changed middle from each side
 * (`-` golden, `+` actual). Good enough for the localized changes a wording or
 * value edit produces, with no external dependency.
 */
function lineDiff(golden: string, actual: string): string {
  const g = golden.split('\n');
  const a = actual.split('\n');
  let start = 0;
  while (start < g.length && start < a.length && g[start] === a[start]) start++;
  let endG = g.length;
  let endA = a.length;
  while (endG > start && endA > start && g[endG - 1] === a[endA - 1]) {
    endG--;
    endA--;
  }
  const lines: string[] = [];
  if (start > 0) lines.push(`  … ${start} matching line(s) …`);
  for (let i = start; i < endG; i++) lines.push(`- ${g[i]}`);
  for (let i = start; i < endA; i++) lines.push(`+ ${a[i]}`);
  const tail = g.length - endG;
  if (tail > 0) lines.push(`  … ${tail} matching line(s) …`);
  return lines.join('\n');
}

/** Compares two archives part-by-part. Empty array ⇒ identical content. */
export async function diffArchives(actual: Uint8Array, golden: Uint8Array): Promise<PartMismatch[]> {
  const a = await normalizeArchive(actual);
  const g = await normalizeArchive(golden);
  const mismatches: PartMismatch[] = [];
  const allParts = [...new Set([...a.keys(), ...g.keys()])].sort();
  for (const part of allParts) {
    const av = a.get(part);
    const gv = g.get(part);
    if (av === undefined) {
      mismatches.push({ part, kind: 'missing-from-actual' });
    } else if (gv === undefined) {
      mismatches.push({ part, kind: 'unexpected-in-actual' });
    } else if (av !== gv) {
      mismatches.push({ part, kind: 'changed', diff: lineDiff(gv, av) });
    }
  }
  return mismatches;
}

function formatMismatches(goldenPath: string, mismatches: PartMismatch[]): string {
  const header =
    `Archive does not match golden file:\n  ${goldenPath}\n` +
    `Re-run with UPDATE_GOLDEN=1 to approve the new output if this change is intended.\n`;
  const body = mismatches
    .map((m) => {
      if (m.kind === 'missing-from-actual') return `  [missing]    ${m.part} — in golden, absent from output`;
      if (m.kind === 'unexpected-in-actual') return `  [unexpected] ${m.part} — in output, absent from golden`;
      return `  [changed]    ${m.part}\n${m.diff}`;
    })
    .join('\n\n');
  return header + '\n' + body;
}

/**
 * Asserts that `actual` archive bytes match the approved golden at `goldenPath`.
 * Writes (and passes) when UPDATE_GOLDEN is set or the golden does not yet
 * exist; otherwise throws a readable per-part diff on mismatch. Callers just
 * `await expectArchiveMatchesGolden(bytes, path)`.
 */
export async function expectArchiveMatchesGolden(actual: Uint8Array, goldenPath: string): Promise<void> {
  if (UPDATE_GOLDEN || !existsSync(goldenPath)) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, actual);
    return;
  }
  const golden = new Uint8Array(readFileSync(goldenPath));
  const mismatches = await diffArchives(actual, golden);
  if (mismatches.length > 0) {
    throw new Error(formatMismatches(goldenPath, mismatches));
  }
}

/**
 * Asserts that `actual` bytes hash to the approved SHA-256 golden at `goldenPath`.
 *
 * For binary outputs that are NOT ZIPs (the merged adjudicator PDF): a raw-byte
 * golden would be multi-megabyte, and a .pdf has no meaningful line diff. Once
 * the output is deterministic (dates/producer pinned), a content hash locks the
 * exact bytes in a tiny text file. Writes (and passes) when UPDATE_GOLDEN is set
 * or the golden does not yet exist; otherwise throws on mismatch. The golden file
 * stores `<sha256>  <bytelength>` for a readable at-a-glance record.
 */
export function expectHashMatchesGolden(actual: Uint8Array, goldenPath: string): void {
  const hash = createHash('sha256').update(actual).digest('hex');
  const line = `${hash}  ${actual.length}\n`;
  if (UPDATE_GOLDEN || !existsSync(goldenPath)) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, line);
    return;
  }
  const golden = readFileSync(goldenPath, 'utf8').trim();
  if (golden !== line.trim()) {
    throw new Error(
      `Output does not match golden hash:\n  ${goldenPath}\n` +
        `  golden: ${golden}\n  actual: ${line.trim()}\n` +
        `Re-run with UPDATE_GOLDEN=1 to approve the new output if this change is intended.`,
    );
  }
}
