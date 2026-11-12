/**
 * Better Auth browser client. Talks to the API service (Slice 13 server), which
 * owns all auth. The API origin and credentials mode come from the shared
 * transport (`api/http.ts`).
 *
 * SAME-ORIGIN by default (Slice 17, #46): in production the app and API are one
 * origin — a reverse proxy on the frontend host forwards /api/* to the API — so
 * Better Auth (mounted at /api/auth) is reachable at the current origin and the
 * session cookie is first-party. We therefore default baseURL to
 * window.location.origin; the API-origin override in api/http.ts applies here
 * too (e.g. pointing a local dev build straight at a remote API).
 */
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { API_CREDENTIALS, apiUrl } from '../api/http';

// apiUrl('') is the configured API origin, or '' for same-origin.
const baseURL =
  apiUrl('') || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080');

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: { credentials: API_CREDENTIALS },
  plugins: [magicLinkClient()],
});

export const { useSession, signIn, signOut } = authClient;
