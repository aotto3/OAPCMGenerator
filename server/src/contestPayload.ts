/**
 * Opaque payload validation — the server's only inspection of a contest, and
 * deliberately shallow. The client sends the exact string serializeContest()
 * produces; we confirm it is the expected envelope and store it verbatim. We do
 * NOT read the contest's domain fields (identity, schools, dates, …); that is
 * the client's job, and keeping the server incurious is the whole point of
 * PRD user story 24 ("the server stores only account and contest data").
 *
 * What we DO enforce, because we never trust the client:
 *  - it is a JSON string that parses to an object;
 *  - it carries a numeric `schemaVersion` and a `contest` object (the envelope
 *    shape — anything else is rejected);
 *  - it contains no device-only credential field. serializeContest() strips
 *    `speechwire` by construction, so its presence means a malformed or hostile
 *    client. We reject rather than sanitize — the server must never be a place
 *    credentials can land, even transiently.
 */

export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadError';
  }
}

export interface OpaqueEnvelope {
  schemaVersion: number;
  /** Structural id from the envelope, when present — used only to cross-check
   * the metadata id, never to interpret the contest. */
  contestId: string | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates that `payload` is the opaque contest envelope. Returns the minimal
 * structural facts the CRUD layer needs; throws PayloadError otherwise. The
 * payload string itself is what gets stored — unchanged.
 */
export function validatePayload(payload: unknown): OpaqueEnvelope {
  if (typeof payload !== 'string') {
    throw new PayloadError('payload must be a JSON string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new PayloadError('payload is not valid JSON');
  }
  if (!isPlainObject(parsed)) {
    throw new PayloadError('payload is not a JSON object');
  }
  if (typeof parsed.schemaVersion !== 'number' || !Number.isFinite(parsed.schemaVersion)) {
    throw new PayloadError('payload is missing a numeric schemaVersion');
  }
  if (!isPlainObject(parsed.contest)) {
    throw new PayloadError('payload is missing a contest object');
  }
  if ('speechwire' in parsed.contest) {
    throw new PayloadError('payload must not contain device-only credential fields');
  }
  const rawId = parsed.contest.id;
  return {
    schemaVersion: parsed.schemaVersion,
    contestId: typeof rawId === 'string' ? rawId : undefined,
  };
}
