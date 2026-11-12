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
 * construction, so no generated ZIP can ever leak them. The ZIP's contest file also
 * drops judge preferences, because a ZIP gets passed around with its documents; the
 * dashboard's export keeps them (PRD #202).
 */

import JSZip from 'jszip';
import {
  contestDisplayName,
  contestFileName,
  serializeContest,
  withoutJudgePreferences,
  type Contest,
} from '../model/contest';
import { buildPanelTabulationPdf } from './panelTabulation';
import { DOCUMENT_REGISTRY, isDocumentSelected, type DocumentResult } from './registry';

export interface GenerateProgress {
  /** Human label of the item currently being built, e.g. "Awards Script". */
  label: string;
  /** 1-based index of this item among the items being built. */
  current: number;
  /** Total items to build (selected documents + the contest file). */
  total: number;
}

/** Non-fatal warnings from building one document (e.g. PDF fields not filled). */
export interface DocumentWarning {
  /** UI label of the document that produced the warnings. */
  document: string;
  /** One or more human-readable warning messages. */
  messages: string[];
}

export interface ContestArchive {
  bytes: Uint8Array;
  /** Top-level ZIP folder name; also the download filename stem (v12). */
  folderName: string;
  /** Number of documents included (excludes the always-present contest file). */
  documentCount: number;
  /** Per-document non-fatal warnings; empty when every document built cleanly. */
  warnings: DocumentWarning[];
}

/** Normalizes a builder's return (bare bytes or {bytes, warnings}) to one shape. */
export function normalizeResult(result: Uint8Array | DocumentResult): {
  bytes: Uint8Array;
  warnings: string[];
} {
  return result instanceof Uint8Array
    ? { bytes: result, warnings: [] }
    : { bytes: result.bytes, warnings: result.warnings ?? [] };
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
  const selected = DOCUMENT_REGISTRY.filter((doc) => isDocumentSelected(doc, contest));

  const zip = new JSZip();
  const folder = zip.folder(folderName);
  if (!folder) throw new Error('Could not create ZIP folder.');

  // +1 for the contest file, which is always written last.
  const total = selected.length + 1;
  let current = 0;
  const warnings: DocumentWarning[] = [];

  for (const doc of selected) {
    current++;
    onProgress?.({ label: doc.label, current, total });
    // build may be sync (placeholder) or async (real .docx/.xlsx/.pdf); await both.
    const { bytes: docBytes, warnings: docWarnings } = normalizeResult(
      await doc.build(contest, { now }),
    );
    folder.file(doc.filename, docBytes);
    if (docWarnings.length > 0) warnings.push({ document: doc.label, messages: docWarnings });
  }

  current++;
  onProgress?.({ label: 'Contest file', current, total });
  folder.file(contestFileName(contest.identity), serializeContest(withoutJudgePreferences(contest)));

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return { bytes, folderName, documentCount: selected.length, warnings };
}

export interface SingleDocument {
  bytes: Uint8Array;
  /** The document's own filename, exactly as it would appear inside the ZIP. */
  filename: string;
  /** UI label, for status lines and warnings. */
  label: string;
  warnings: DocumentWarning[];
}

/**
 * When exactly one document is selected, builds just that document so it can be
 * downloaded on its own, skipping the ZIP (and the contest file that rides in it).
 * Null for any other selection size, where the ZIP is the download.
 */
export async function buildSingleDocument(
  contest: Contest,
  { now }: Pick<BuildOptions, 'now'> = {},
): Promise<SingleDocument | null> {
  const selected = DOCUMENT_REGISTRY.filter((doc) => isDocumentSelected(doc, contest));
  if (selected.length !== 1) return null;
  const doc = selected[0];
  const { bytes, warnings } = normalizeResult(await doc.build(contest, { now }));
  return {
    bytes,
    filename: doc.filename,
    label: doc.label,
    warnings: warnings.length > 0 ? [{ document: doc.label, messages: warnings }] : [],
  };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** Saves one built document under its own filename (browser only). */
export function triggerSingleDocumentDownload(doc: SingleDocument): void {
  const ext = doc.filename.split('.').pop()?.toLowerCase() ?? '';
  const blob = new Blob([doc.bytes as BlobPart], { type: MIME_BY_EXTENSION[ext] ?? 'application/octet-stream' });
  triggerDownload(blob, doc.filename);
}

/**
 * Saves ZIP bytes to disk as "<folderName>.zip" (browser only). Kept out of
 * buildContestArchive so the packaging logic stays DOM-free and testable.
 */
export function triggerZipDownload(archive: ContestArchive): void {
  const blob = new Blob([archive.bytes as BlobPart], { type: 'application/zip' });
  triggerDownload(blob, `${archive.folderName}.zip`);
}

/**
 * Exports just the portable contest file — the versioned serializeContest() JSON,
 * downloaded on its own (a backup / handoff that re-imports on any machine). Unlike
 * the ZIP's copy it keeps judge preferences, so this is the complete backup.
 * serializeContest() strips device-only Speechwire credentials by construction, so
 * an exported file can never leak them.
 */
export function triggerContestFileDownload(contest: Contest): void {
  const blob = new Blob([serializeContest(contest)], { type: 'application/json' });
  triggerDownload(blob, contestFileName(contest.identity));
}

/**
 * Saves Panel Tabulation.pdf on its own (the tabulation's Email to UIL button
 * downloads it to attach by hand, since an email link cannot carry a file).
 */
export async function triggerPanelTabulationDownload(contest: Contest): Promise<void> {
  const bytes = await buildPanelTabulationPdf(contest);
  triggerDownload(new Blob([bytes as BlobPart], { type: 'application/pdf' }), 'Panel Tabulation.pdf');
}

/** Shared anchor-click download (v12 behavior), used by the exports above. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
