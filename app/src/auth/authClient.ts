/**
 * Better Auth browser client. Talks to the API service (Slice 13 server), which
 * owns all auth. This is the ONLY place the frontend knows the API origin.
 *
 * SAME-ORIGIN by default (Slice 17, #46): in production the app and API are one
 * origin — a reverse proxy on the frontend host forwards /api/* to the API — so
 * Better Auth (mounted at /api/auth) is reachable at the current origin and the
 * session cookie is first-party. We therefore default baseURL to
 * window.location.origin. Set `VITE_API_URL` only to override (e.g. pointing a
 * local dev build straight at a remote API without the dev proxy).
 */
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';

const baseURL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080');

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: { credentials: 'include' },
  plugins: [magicLinkClient()],
});

export const { useSession, signIn, signOut } = authClient;
