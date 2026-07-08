/**
 * Better Auth browser client. Talks to the API service (Slice 13 server), which
 * owns all auth. This is the ONLY place the frontend knows the API origin.
 *
 * `VITE_API_URL` is the API service's origin (e.g. https://api.example.com);
 * Better Auth mounts under /api/auth there. In local dev it defaults to the
 * server's default port. Cross-site auth needs credentialed requests, so the
 * session cookie rides along — the server sets SameSite=None; Secure in prod.
 */
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: { credentials: 'include' },
  plugins: [magicLinkClient()],
});

export const { useSession, signIn, signOut } = authClient;
