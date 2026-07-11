/**
 * The one account-acting seam. Everywhere else the server only OBSERVES accounts
 * (reads the directory, the log, contest metadata); this is the single, scoped,
 * audited exception — an admin having Better Auth email a locked-out user a fresh
 * sign-in link.
 *
 * It is injected into the app factory like `repo` / `eventLog` / `userDirectory`,
 * so the admin routes depend on this interface, not on Better Auth being present:
 * production wraps `auth.api.signInMagicLink` (wired in server.ts, the one place
 * that holds real auth), while the integration tests pass a fake that records the
 * call. The constructor stays the test seam — there is no test-only branch.
 */
export interface AuthAdmin {
  /**
   * Sends a fresh magic sign-in link to `email` via the auth provider. Rejects if
   * the provider send fails; the caller treats a rejection as a 500 and writes no
   * audit event.
   */
  sendSignInLink(email: string): Promise<void>;
}
