/**
 * Network boundary for the judge questionnaire (PRD #252): the signed-in CM's
 * link + roster calls, and the public page's lookup. Same-origin and credentialed
 * like the sync client; `fetchImpl` is injectable for tests.
 */
import type { JudgeRoster, RosterContest } from './roster';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export interface JudgeLookup {
  judgeName: string;
  contests: RosterContest[];
}

export type LookupResult =
  | { kind: 'found'; judge: JudgeLookup }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'error' };

export class QuestionnaireHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Server responded ${status}`);
    this.name = 'QuestionnaireHttpError';
  }
}

export function createQuestionnaireClient(fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetchImpl(`${API_URL}/api/questionnaire${path}`, {
      credentials: 'include',
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      ...init,
    });
    if (!res.ok) throw new QuestionnaireHttpError(res.status);
    return res;
  }

  return {
    async getLinkToken(): Promise<string> {
      return ((await (await call('/link')).json()) as { token: string }).token;
    },
    async resetLinkToken(): Promise<string> {
      return ((await (await call('/link/reset', { method: 'POST' })).json()) as { token: string }).token;
    },
    async publishRoster(roster: JudgeRoster): Promise<void> {
      await call('/roster', { method: 'PUT', body: JSON.stringify({ roster }) });
    },
    /** Never throws: the public page only needs to know which message to show. */
    async lookup(token: string, email: string, website: string): Promise<LookupResult> {
      try {
        const res = await call('/public/lookup', {
          method: 'POST',
          credentials: 'omit',
          body: JSON.stringify({ token, email, website }),
        });
        return { kind: 'found', judge: (await res.json()) as JudgeLookup };
      } catch (err) {
        if (err instanceof QuestionnaireHttpError && err.status === 404) return { kind: 'not_found' };
        if (err instanceof QuestionnaireHttpError && err.status === 429) return { kind: 'rate_limited' };
        return { kind: 'error' };
      }
    },
  };
}

export type QuestionnaireClient = ReturnType<typeof createQuestionnaireClient>;

/** The public questionnaire URL for a token, on this origin. */
export function questionnaireUrl(origin: string, token: string): string {
  return `${origin}/q/${encodeURIComponent(token)}`;
}

/** The token from a /q/<token> path, or null for any other path. */
export function questionnaireTokenFromPath(pathname: string): string | null {
  const match = /^\/q\/([A-Za-z0-9_-]{1,64})\/?$/.exec(pathname);
  return match ? match[1] : null;
}
