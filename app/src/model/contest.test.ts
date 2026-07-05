import { describe, expect, it } from 'vitest';
import {
  CONTEST_SCHEMA_VERSION,
  contestDisplayName,
  contestFullName,
  contestNamePreview,
  contestTitleLong,
  createContest,
  parseContest,
  serializeContest,
  validateContest,
  withIdentity,
  type Contest,
} from './contest';

const NOW = '2026-07-05T12:00:00.000Z';

function contest(identity: Partial<Contest['identity']> = {}): Contest {
  return createContest({ id: 'test-id', now: NOW, identity });
}

describe('createContest', () => {
  it('mirrors v12 defaults: current year, District, 5A, everything else blank', () => {
    const c = contest();
    expect(c.identity).toEqual({
      contestYear: '2026',
      contestLevel: 'District',
      classification: '5A',
      districtNumber: '',
      hostSchoolName: '',
      hostVenueName: '',
      hostAddress: '',
    });
    expect(c.createdAt).toBe(NOW);
    expect(c.updatedAt).toBe(NOW);
  });

  it('generates a unique id when none is given', () => {
    expect(createContest().id).not.toBe(createContest().id);
  });
});

describe('withIdentity', () => {
  it('patches fields immutably and bumps updatedAt', () => {
    const before = contest();
    const after = withIdentity(before, { districtNumber: '20' }, '2026-07-06T00:00:00.000Z');
    expect(after.identity.districtNumber).toBe('20');
    expect(after.updatedAt).toBe('2026-07-06T00:00:00.000Z');
    expect(before.identity.districtNumber).toBe(''); // original untouched
  });
});

describe('derived names (v12 formats)', () => {
  const id = contest({ contestYear: '2026', districtNumber: '20' }).identity;

  it('display / folder name: "2026 — 5A District 20 OAP"', () => {
    expect(contestDisplayName(id)).toBe('2026 — 5A District 20 OAP');
  });

  it('name preview: "2026 — 5A — District 20 — OAP"', () => {
    expect(contestNamePreview(id)).toBe('2026 — 5A — District 20 — OAP');
  });

  it('full name: "UIL 5A District 20 One-Act Play Contest"', () => {
    expect(contestFullName(id)).toBe('UIL 5A District 20 One-Act Play Contest');
  });

  it('long title: "2026 UIL 5A District 20 One-Act Play Contest"', () => {
    expect(contestTitleLong(id)).toBe('2026 UIL 5A District 20 One-Act Play Contest');
  });

  it('omits the number when districtNumber is blank (e.g. BiDistrict)', () => {
    const bidc = contest({ contestLevel: 'BiDistrict', districtNumber: '' }).identity;
    expect(contestDisplayName(bidc)).toBe('2026 — 5A BiDistrict OAP');
    expect(contestFullName(bidc)).toBe('UIL 5A BiDistrict One-Act Play Contest');
  });

  it('drops empty segments in the preview like v12 filter(Boolean)', () => {
    const noYear = contest({ contestYear: '', districtNumber: '20' }).identity;
    expect(contestNamePreview(noYear)).toBe('5A — District 20 — OAP');
  });

  it('trims whitespace in year and number like v12', () => {
    const padded = contest({ contestYear: ' 2026 ', districtNumber: ' 20 ' }).identity;
    expect(contestNamePreview(padded)).toBe('2026 — 5A — District 20 — OAP');
  });
});

describe('validateContest', () => {
  it('accepts the default contest', () => {
    expect(validateContest(contest())).toEqual([]);
  });

  it('flags a blank year', () => {
    const issues = validateContest(contest({ contestYear: '' }));
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('contestYear');
  });

  it('flags a non-4-digit year', () => {
    expect(validateContest(contest({ contestYear: '26' }))[0].field).toBe('contestYear');
  });

  it('flags out-of-enum level and classification', () => {
    const c = contest();
    const bad = {
      ...c,
      identity: { ...c.identity, contestLevel: 'State' as never, classification: '7A' as never },
    };
    expect(validateContest(bad).map((i) => i.field)).toEqual(['contestLevel', 'classification']);
  });
});

describe('serialize / parse', () => {
  it('round-trips a contest exactly', () => {
    const c = contest({ districtNumber: '20', hostSchoolName: 'Friendswood High School' });
    expect(parseContest(serializeContest(c))).toEqual(c);
  });

  it('writes the current schema version into the envelope', () => {
    const envelope = JSON.parse(serializeContest(contest()));
    expect(envelope.schemaVersion).toBe(CONTEST_SCHEMA_VERSION);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseContest('not json')).toThrow(/not valid JSON/);
  });

  it('rejects payloads without a schemaVersion', () => {
    expect(() => parseContest(JSON.stringify({ contest: contest() }))).toThrow(/schemaVersion/);
  });

  it('rejects payloads from a newer schema version', () => {
    const future = JSON.stringify({ schemaVersion: CONTEST_SCHEMA_VERSION + 1, contest: contest() });
    expect(() => parseContest(future)).toThrow(/newer/);
  });

  it('rejects a malformed contest record', () => {
    expect(() =>
      parseContest(JSON.stringify({ schemaVersion: CONTEST_SCHEMA_VERSION, contest: { nope: true } })),
    ).toThrow(/malformed/);
  });
});
