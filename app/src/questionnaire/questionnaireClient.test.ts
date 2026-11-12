/**
 * The questionnaire client over the shared transport: each call's endpoint, the
 * public calls' status-to-result mapping (the page shows a message per result,
 * never an exception), and the /q/<token> path parser. `fetch` is injected.
 */
import { describe, expect, it } from 'vitest';
import { createQuestionnaireClient, questionnaireTokenFromPath, questionnaireUrl } from './questionnaireClient';
import type { SubmissionAnswers } from './submission';

function recordingFetch(responder: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return responder();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

const offline = (async () => {
  throw new TypeError('Failed to fetch');
}) as typeof fetch;

const answers = {} as SubmissionAnswers;

describe('submit', () => {
  it('a 2xx is saved with the server timestamp, posted without cookies', async () => {
    const { fn, calls } = recordingFetch(() => json(200, { submittedAt: '2026-11-12T10:00:00.000Z' }));
    const result = await createQuestionnaireClient(fn).submit('tok', 'j@x.test', '', answers);
    expect(result).toEqual({ kind: 'saved', submittedAt: '2026-11-12T10:00:00.000Z' });
    expect(calls[0].url).toBe('/api/questionnaire/public/submit');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.credentials).toBe('omit');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      token: 'tok',
      email: 'j@x.test',
      website: '',
      answers,
    });
  });

  it.each([
    [404, 'not_found'],
    [429, 'rate_limited'],
    [400, 'invalid'],
    [500, 'error'],
  ])('a %i maps to %s', async (status, kind) => {
    const { fn } = recordingFetch(() => json(status));
    expect(await createQuestionnaireClient(fn).submit('t', 'e', '', answers)).toEqual({ kind });
  });

  it('a network failure maps to error', async () => {
    expect(await createQuestionnaireClient(offline).submit('t', 'e', '', answers)).toEqual({ kind: 'error' });
  });
});

describe('lookup', () => {
  it('a 2xx is found with the judge, posted without cookies', async () => {
    const judge = { judgeName: 'Pat', contests: [], lastSubmission: null };
    const { fn, calls } = recordingFetch(() => json(200, judge));
    expect(await createQuestionnaireClient(fn).lookup('tok', 'j@x.test', '')).toEqual({ kind: 'found', judge });
    expect(calls[0].url).toBe('/api/questionnaire/public/lookup');
    expect(calls[0].init?.credentials).toBe('omit');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ token: 'tok', email: 'j@x.test', website: '' });
  });

  it.each([
    [404, 'not_found'],
    [429, 'rate_limited'],
    [400, 'error'],
    [503, 'error'],
  ])('a %i maps to %s', async (status, kind) => {
    const { fn } = recordingFetch(() => json(status));
    expect(await createQuestionnaireClient(fn).lookup('t', 'e', '')).toEqual({ kind });
  });

  it('a network failure maps to error', async () => {
    expect(await createQuestionnaireClient(offline).lookup('t', 'e', '')).toEqual({ kind: 'error' });
  });
});

describe('signed-in calls', () => {
  it('link, reset, roster and submissions hit their endpoints with the session', async () => {
    const replies = [
      json(200, { token: 'a' }),
      json(200, { token: 'b' }),
      new Response(null, { status: 204 }),
      json(200, { submissions: [{ email: 'j@x.test' }] }),
    ];
    const { fn, calls } = recordingFetch(() => replies.shift()!);
    const client = createQuestionnaireClient(fn);
    const roster = { contests: [], judges: [] } as unknown as Parameters<typeof client.publishRoster>[0];
    expect(await client.getLinkToken()).toBe('a');
    expect(await client.resetLinkToken()).toBe('b');
    await client.publishRoster(roster);
    expect(await client.listSubmissions()).toEqual([{ email: 'j@x.test' }]);
    expect(calls.map((c) => `${c.init?.method} ${c.url}`)).toEqual([
      'GET /api/questionnaire/link',
      'POST /api/questionnaire/link/reset',
      'PUT /api/questionnaire/roster',
      'GET /api/questionnaire/submissions',
    ]);
    expect(calls.every((c) => c.init?.credentials === 'include')).toBe(true);
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ roster });
  });

  it('a failed signed-in call rejects with the status', async () => {
    const { fn } = recordingFetch(() => json(401));
    await expect(createQuestionnaireClient(fn).getLinkToken()).rejects.toMatchObject({ status: 401 });
  });
});

describe('questionnaire paths', () => {
  it('builds the public URL for a token', () => {
    expect(questionnaireUrl('https://app.test', 'abc_DEF-1')).toBe('https://app.test/q/abc_DEF-1');
  });

  it('parses the token from /q/<token>, with or without a trailing slash', () => {
    expect(questionnaireTokenFromPath('/q/abc_DEF-1')).toBe('abc_DEF-1');
    expect(questionnaireTokenFromPath('/q/abc/')).toBe('abc');
    expect(questionnaireTokenFromPath(`/q/${'a'.repeat(64)}`)).toBe('a'.repeat(64));
  });

  it('rejects any other path, an empty token, odd characters or an over-long token', () => {
    expect(questionnaireTokenFromPath('/')).toBeNull();
    expect(questionnaireTokenFromPath('/q/')).toBeNull();
    expect(questionnaireTokenFromPath('/q/a b')).toBeNull();
    expect(questionnaireTokenFromPath('/q/abc/extra')).toBeNull();
    expect(questionnaireTokenFromPath('/x/q/abc')).toBeNull();
    expect(questionnaireTokenFromPath(`/q/${'a'.repeat(65)}`)).toBeNull();
  });
});
