import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  DOCUMENT_TYPES,
  addCustomPreferenceList,
  addRankedJudge,
  addVetoedJudge,
  contestDisplayName,
  contestFileName,
  createContest,
  defaultJudgePreferences,
  parseContest,
  serializeContest,
  setAllDocuments,
  setDocumentSelected,
  setJudgeUnavailable,
  setNumSchools,
  validateContest,
  withDetails,
  withSchool,
  withSpeechwire,
  type Contest,
} from '../model/contest';
import { setJudge } from '../model/judgePanel';
import { DOCUMENT_GROUPS, DOCUMENT_REGISTRY, isDocumentAvailable } from './registry';
import { buildContestArchive, buildSingleDocument, normalizeResult } from './generate';

const NOW = '2026-07-05T12:00:00.000Z';

function contest(): Contest {
  return createContest({ id: 'test-id', now: NOW, identity: { district: '20' } });
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

  it('builds non-empty bytes for every document', async () => {
    // This asserts a property of every builder (it runs and emits bytes), not a
    // golden — so it uses the smallest contest that still exercises them all.
    // The adjudicator PDF cost is ~(numJudges × schools) pages, so 1 judge / 1
    // school keeps it a handful of pages instead of the fixture's 113. The full
    // 113-page build is covered once, against the golden hash, in the slice-9 suite.
    // Documents that need data this contest lacks (Panel Tabulation needs a full
    // 3-judge ballot) are never built for it; their own suites cover them.
    const small = withDetails(setNumSchools(contest(), 1), { numJudges: 1 });
    for (const doc of DOCUMENT_REGISTRY.filter((d) => isDocumentAvailable(d, small))) {
      // build may be sync (placeholder) or async (real .docx/.xlsx/.pdf) and may
      // return bare bytes or {bytes, warnings}; normalizeResult handles all.
      const { bytes } = normalizeResult(await doc.build(small));
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
    }
  }, 30000);
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

describe('DOCUMENT_GROUPS', () => {
  it('places every document in exactly one group', () => {
    const grouped = DOCUMENT_GROUPS.flatMap((g) => g.documents);
    expect([...grouped].sort()).toEqual(DOCUMENT_TYPES.map((d) => d.id).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

describe('buildSingleDocument', () => {
  it('builds the one selected document under its own filename, byte-identical to its ZIP copy', async () => {
    let c = setAllDocuments(contest(), false);
    c = setDocumentSelected(c, 'awards', true);
    const now = new Date('2026-03-21T12:00:00Z');
    const single = await buildSingleDocument(c, { now });
    expect(single).not.toBeNull();
    expect(single!.filename).toBe('Awards Script.docx');
    const archive = await buildContestArchive(c, { now });
    const zipped = await (await unzip(archive.bytes)).file(`${archive.folderName}/Awards Script.docx`)!.async('uint8array');
    expect(single!.bytes).toEqual(zipped);
  });

  it('is null unless exactly one document is selected', async () => {
    const none = setAllDocuments(contest(), false);
    expect(await buildSingleDocument(none)).toBeNull();
    const two = setDocumentSelected(setDocumentSelected(none, 'awards', true), 'checklist', true);
    expect(await buildSingleDocument(two)).toBeNull();
  });
});

describe('judge preferences stay out of documents (PRD #202)', () => {
  it('leaves no preference name in any generated document', async () => {
    const MARKER = 'Zzpreferencemarker';
    const VETO_MARKER = 'Zzvetomarker';
    const small = withDetails(setNumSchools(contest(), 1), { numJudges: 1 });
    let c = addVetoedJudge(addRankedJudge(small, { kind: 'school', index: 0 }, `${MARKER} Judge`), { kind: 'school', index: 0 }, `${VETO_MARKER} Judge`);
    c = addRankedJudge(c, { kind: 'firstDistrict' }, `${MARKER} District`);
    c = addCustomPreferenceList(c, `${MARKER} List`);
    c = addVetoedJudge(c, { kind: 'custom', id: c.judgePreferences.customLists[0].id }, `${VETO_MARKER} Custom`);
    c = setJudgeUnavailable(c, `${MARKER} Judge`, true);
    for (const doc of DOCUMENT_REGISTRY.filter((d) => isDocumentAvailable(d, c))) {
      const { bytes } = normalizeResult(await doc.build(c));
      // .docx/.xlsx are ZIPs (signature "PK"); search each part. PDFs search as raw bytes.
      const texts =
        bytes[0] === 0x50 && bytes[1] === 0x4b
          ? await Promise.all(Object.values((await unzip(bytes)).files).map((f) => f.async('string')))
          : [Buffer.from(bytes).toString('latin1')];
      for (const text of texts) {
        expect(text).not.toContain(MARKER);
        expect(text).not.toContain(MARKER.toLowerCase());
        expect(text).not.toContain(VETO_MARKER);
      }
    }
  }, 30000);

  describe('the contest file in the ZIP', () => {
    const SCHOOL = { kind: 'school', index: 0 } as const;
    const MARKER = 'Zzpreferencemarker';

    function withPreferences(): Contest {
      let c = setAllDocuments(contest(), false);
      c = addVetoedJudge(addRankedJudge(c, SCHOOL, `${MARKER} Ranked`), SCHOOL, `${MARKER} Vetoed`);
      c = addRankedJudge(c, { kind: 'firstDistrict' }, `${MARKER} First`);
      c = addVetoedJudge(c, { kind: 'secondDistrict' }, `${MARKER} Second`);
      c = addCustomPreferenceList(c, `${MARKER} List`);
      c = addRankedJudge(c, { kind: 'custom', id: c.judgePreferences.customLists[0].id }, `${MARKER} Custom`);
      return setJudgeUnavailable(c, `${MARKER} Ranked`, true);
    }

    async function zippedFile(c: Contest): Promise<string> {
      const { bytes, folderName } = await buildContestArchive(c);
      const file = (await unzip(bytes)).file(`${folderName}/${contestFileName(c.identity)}`);
      return file!.async('string');
    }

    it('holds no rankings, vetoes, custom lists, or Unavailable marks', async () => {
      const text = await zippedFile(withPreferences());
      expect(text.toLowerCase()).not.toContain(MARKER.toLowerCase());
      const parsed = parseContest(text);
      expect(parsed.judgePreferences).toEqual(defaultJudgePreferences());
      expect(parsed.schools.every((s) => s.judgePreferences.ranked.length === 0)).toBe(true);
      expect(parsed.schools.every((s) => s.judgePreferences.vetoes.length === 0)).toBe(true);
    });

    it('keeps everything else, including the hired judges', async () => {
      let c = withSchool(withPreferences(), 0, { name: 'Keeper High' });
      c = setJudge(c, 0, { name: 'Hired Judge' });
      const parsed = parseContest(await zippedFile(c));
      expect(parsed.schools[0].name).toBe('Keeper High');
      expect(parsed.adjudicators[0].name).toBe('Hired Judge');
      expect(parsed.identity).toEqual(c.identity);
      expect(parsed.updatedAt).toBe(c.updatedAt);
    });

    it('leaves the contest being worked on, and a plain serialized file, with their preferences', async () => {
      const c = withPreferences();
      await buildContestArchive(c);
      expect(c.schools[0].judgePreferences.ranked).toEqual([`${MARKER} Ranked`]);
      expect(serializeContest(c)).toContain(MARKER);
    });
  });
});
