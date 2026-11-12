/**
 * Network boundary for the judge questionnaire (PRD #252): the signed-in CM's
 * link + roster calls, and the public page's lookup and submit. Built on the
 * shared transport (`api/http.ts`); the public calls send no cookies.
 * `fetchImpl` is injectable for tests.
 */
import type { JudgeRoster, RosterContest } from './roster';
import type { JudgeSubmission, SubmissionAnswers } from './submission';
import { ApiHttpError, createApi } from '../api/http';

export interface JudgeLookup {
  judgeName: string;
  contests: RosterContest[];
  /** The judge's previous answers, to pre-fill the form; null on a first visit. */
  lastSubmission: SubmissionAnswers | null;
}

export type SubmitResult =
  | { kind: 'saved'; submittedAt: string }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'invalid' }
  | { kind: 'error' };

export type LookupResult =
  | { kind: 'found'; judge: JudgeLookup }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'error' };

/** The HTTP status of a failed call, or null when it never got an answer. */
function statusOf(err: unknown): number | null {
  return err instanceof ApiHttpError ? err.status : null;
}

export function createQuestionnaireClient(fetchImpl?: typeof fetch) {
  const api = createApi(fetchImpl);
  const base = '/api/questionnaire';

  return {
    async getLinkToken(): Promise<string> {
      return (await api.get<{ token: string }>(`${base}/link`)).token;
    },
    async resetLinkToken(): Promise<string> {
      return (await api.send<{ token: string }>('POST', `${base}/link/reset`)).token;
    },
    async publishRoster(roster: JudgeRoster): Promise<void> {
      await api.send('PUT', `${base}/roster`, { roster });
    },
    async listSubmissions(): Promise<JudgeSubmission[]> {
      return (await api.get<{ submissions: JudgeSubmission[] }>(`${base}/submissions`)).submissions;
    },
    /** Never throws: the public page only needs to know which message to show. */
    async submit(token: string, email: string, website: string, answers: SubmissionAnswers): Promise<SubmitResult> {
      try {
        const body = await api.send<{ submittedAt: string }>(
          'POST',
          `${base}/public/submit`,
          { token, email, website, answers },
          { anonymous: true },
        );
        return { kind: 'saved', submittedAt: body.submittedAt };
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return { kind: 'not_found' };
        if (status === 429) return { kind: 'rate_limited' };
        if (status === 400) return { kind: 'invalid' };
        return { kind: 'error' };
      }
    },
    /** Never throws: the public page only needs to know which message to show. */
    async lookup(token: string, email: string, website: string): Promise<LookupResult> {
      try {
        const judge = await api.send<JudgeLookup>(
          'POST',
          `${base}/public/lookup`,
          { token, email, website },
          { anonymous: true },
        );
        return { kind: 'found', judge };
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return { kind: 'not_found' };
        if (status === 429) return { kind: 'rate_limited' };
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
