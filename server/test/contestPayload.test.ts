/**
 * Opaque-payload validation. These assert the server's contract at the model
 * boundary: it accepts exactly the serializeContest() envelope, stores it
 * without interpreting the contest, and refuses anything malformed or carrying
 * credentials — independent of the HTTP layer.
 */
import { describe, expect, it } from 'vitest';
import { PayloadError, validatePayload } from '../src/contestPayload';

const envelope = (contest: Record<string, unknown>, schemaVersion = 3): string =>
  JSON.stringify({ schemaVersion, contest });

describe('validatePayload', () => {
  it('accepts a well-formed envelope and returns its structural id', () => {
    const result = validatePayload(envelope({ id: 'c1', identity: { hostSchoolName: 'X' } }));
    expect(result).toEqual({ schemaVersion: 3, contestId: 'c1' });
  });

  it('accepts an envelope with no contest id (id is optional to the server)', () => {
    expect(validatePayload(envelope({ identity: {} })).contestId).toBeUndefined();
  });

  it('does not interpret contest internals — any shape of contest object passes', () => {
    // Arbitrary nested junk that is not a real contest is still a valid opaque
    // payload as far as the server is concerned.
    expect(() => validatePayload(envelope({ id: 'c1', anything: { deeply: [1, 2, 3] } }))).not.toThrow();
  });

  it.each([
    ['a non-string', 42],
    ['null', null],
    ['a JSON array string', '[]'],
    ['invalid JSON', '{not json'],
    ['a JSON primitive', '"hello"'],
  ])('rejects %s', (_label, input) => {
    expect(() => validatePayload(input)).toThrow(PayloadError);
  });

  it('rejects an envelope missing schemaVersion', () => {
    expect(() => validatePayload(JSON.stringify({ contest: { id: 'c1' } }))).toThrow(/schemaVersion/);
  });

  it('rejects a non-numeric schemaVersion', () => {
    expect(() => validatePayload(JSON.stringify({ schemaVersion: '3', contest: {} }))).toThrow(/schemaVersion/);
  });

  it('rejects an envelope with no contest object', () => {
    expect(() => validatePayload(JSON.stringify({ schemaVersion: 3 }))).toThrow(/contest object/);
  });

  it('rejects a payload carrying device-only credential fields', () => {
    const withCreds = envelope({ id: 'c1', speechwire: { username: 'u', password: 'p' } });
    expect(() => validatePayload(withCreds)).toThrow(/credential/);
  });
});
