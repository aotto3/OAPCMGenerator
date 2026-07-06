/**
 * Document engine — ZIP packaging.
 *
 * buildContestArchive() is the pure core (contest in → ZIP bytes out): it loops
 * the document registry, builds every selected document, and drops the versioned
 * contest file into the same folder. No DOM — it runs in tests and (later) any
 * worker. triggerZipDownload() is the thin browser-only wrapper that saves the
 * bytes to the user's disk, matching v12's anchor-click download.
 *
 * The ZIP layout mirrors v12: a single top-level folder named per the PRD
 * convention ("2026 — 5A District 20 OAP"), containing the documents and the
 * contest file. serializeContest() strips device-only Speechwire credentials by
 * construction, so no generated ZIP can ever leak them.
 */

import JSZip from 'jszip';
import {
  contestDisplayName,
  contestFileName,
  serializeContest,
  type Contest,
} from '../model/contest';
import { DOCUMENT_REGISTRY } from './registry';

export interface GenerateProgress {
  /** Human label of the item currently being built, e.g. "Awards Script". */
  label: string;
  /** 1-based index of this item among the items being built. */
  current: number;
  /** Total items to build (selected documents + the contest file). */
  total: number;
}

export interface ContestArchive {
  bytes: Uint8Array;
  /** Top-level ZIP folder name; also the download filename stem (v12). */
  folderName: string;
  /** Number of documents included (excludes the always-present contest file). */
  documentCount: number;
}

export interface BuildOptions {
  /** Called before each item is built, for a v12-style per-document status line. */
  onProgress?: (progress: GenerateProgress) => void;
  /**
   * Date stamped on documents that print a "letter date" (see
   * DocumentBuildContext). Defaults to now, so production ZIPs read "today";
   * tests pass a fixed date for deterministic output.
   */
  now?: Date;
}

/**
 * Builds the contest ZIP from the current document selection. Pure aside from
 * JSZip — safe to call in tests. The contest file is always included, even when
 * no documents are selected, so every archive is a portable backup.
 */
export async function buildContestArchive(
  contest: Contest,
  { onProgress, now }: BuildOptions = {},
): Promise<ContestArchive> {
  const folderName = contestDisplayName(contest.identity);
  const selected = DOCUMENT_REGISTRY.filter((doc) => contest.documents[doc.id]);

  const zip = new JSZip();
  const folder = zip.folder(folderName);
  if (!folder) throw new Error('Could not create ZIP folder.');

  // +1 for the contest file, which is always written last.
  const total = selected.length + 1;
  let current = 0;

  for (const doc of selected) {
    current++;
    onProgress?.({ label: doc.label, current, total });
    // build may be sync (placeholder) or async (real .docx/.xlsx); await both.
    folder.file(doc.filename, await doc.build(contest, { now }));
  }

  current++;
  onProgress?.({ label: 'Contest file', current, total });
  folder.file(contestFileName(contest.identity), serializeContest(contest));

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return { bytes, folderName, documentCount: selected.length };
}

/**
 * Saves ZIP bytes to disk as "<folderName>.zip" (browser only). Kept out of
 * buildContestArchive so the packaging logic stays DOM-free and testable.
 */
export function triggerZipDownload(archive: ContestArchive): void {
  const blob = new Blob([archive.bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${archive.folderName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
