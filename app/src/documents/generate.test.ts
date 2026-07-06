import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  DOCUMENT_TYPES,
  contestDisplayName,
  contestFileName,
  createContest,
  parseContest,
  setAllDocuments,
  setDocumentSelected,
  validateContest,
  withSpeechwire,
  type Contest,
} from '../model/contest';
import { DOCUMENT_REGISTRY } from './registry';
import { buildContestArchive } from './generate';

const NOW = '2026-07-05T12:00:00.000Z';

function contest(): Contest {
  return createContest({ id: 'test-id', now: NOW, identity: { districtNumber: '20' } });
}

describe('DOCUMENT_REGISTRY', () => {
  it('covers every document type in the model, in the same order', () => {
    expect(DOCUMENT_REGISTRY.map((d) => d.id)).toEqual(DOCUMENT_TYPES.map((d) => d.id));
  });

  it('carries the model label and default-selected flag for each document', () => {
    for (const doc of DOCUMENT_TYPES) {
      const entry = DOCUMENT_REGISTRY.find((d) => d.id === doc.id)!;
      expect(entry.label).toBe(doc.label);
      expect(entry.defaultSelected).toBe(doc.defaultSelected);
    }
  });

  it('gives every document a unique, non-empty filename', () => {
    const names = DOCUMENT_REGISTRY.map((d) => d.filename);
    expect(names.every((n) => n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('builds non-empty bytes for every document', () => {
    for (const doc of DOCUMENT_REGISTRY) {
      const bytes = doc.build(contest());
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
    }
  });
});

/** Reads a ZIP archive back into its entry paths and folder name. */
async function unzip(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return zip;
}

describe('buildContestArchive', () => {
  it('names the folder per the display-name convention', async () => {
    const c = contest();
    const archive = await buildContestArchive(c);
    expect(archive.folderName).toBe(contestDisplayName(c.identity));
    const zip = await unzip(archive.bytes);
    expect(zip.folder(archive.folderName)).not.toBeNull();
  });

  it('includes only the selected documents, plus the contest file', async () => {
    let c = setAllDocuments(contest(), false);
    c = setDocumentSelected(c, 'checklist', true);
    c = setDocumentSelected(c, 'awards', true);

    const archive = await buildContestArchive(c);
    expect(archive.documentCount).toBe(2);

    const zip = await unzip(archive.bytes);
    const files = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name);
    expect(files).toContain(`${archive.folderName}/Year-Round Checklist.xlsx`);
    expect(files).toContain(`${archive.folderName}/Awards Script.docx`);
    expect(files).toContain(`${archive.folderName}/${contestFileName(c.identity)}`);
    // 2 documents + 1 contest file, nothing else
    expect(files).toHaveLength(3);
  });

  it('always includes the contest file, even with no documents selected', async () => {
    const c = setAllDocuments(contest(), false);
    const archive = await buildContestArchive(c);
    expect(archive.documentCount).toBe(0);

    const zip = await unzip(archive.bytes);
    const files = Object.values(zip.files).filter((f) => !f.dir);
    expect(files.map((f) => f.name)).toEqual([`${archive.folderName}/${contestFileName(c.identity)}`]);
  });

  it('bundles a contest file that round-trips through parse + validate', async () => {
    const c = contest();
    const archive = await buildContestArchive(c);
    const zip = await unzip(archive.bytes);

    const json = await zip.file(`${archive.folderName}/${contestFileName(c.identity)}`)!.async('string');
    const parsed = parseContest(json);
    expect(parsed.id).toBe(c.id);
    expect(validateContest(parsed)).toEqual([]);
  });

  it('never writes device-only Speechwire credentials into the contest file', async () => {
    const c = withSpeechwire(contest(), { username: 'district20-5a', password: 's3cr3t-pw' });
    const archive = await buildContestArchive(c);
    const zip = await unzip(archive.bytes);

    const json = await zip.file(`${archive.folderName}/${contestFileName(c.identity)}`)!.async('string');
    expect(json).not.toContain('s3cr3t-pw');
    expect(json).not.toContain('district20-5a');
    expect(json).not.toContain('speechwire');
  });

  it('reports per-item progress: one call per document plus the contest file', async () => {
    let c = setAllDocuments(contest(), false);
    c = setDocumentSelected(c, 'checklist', true);
    c = setDocumentSelected(c, 'awards', true);

    const onProgress = vi.fn();
    await buildContestArchive(c, { onProgress });

    // 2 documents + contest file = 3 progress calls, each reporting total 3.
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls.map(([p]) => p.current)).toEqual([1, 2, 3]);
    expect(onProgress.mock.calls.every(([p]) => p.total === 3)).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith({ label: 'Contest file', current: 3, total: 3 });
  });
});
