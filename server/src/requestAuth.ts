/**
 * Request-auth vocabulary shared by every router — the authenticated-caller shape,
 * the resolver seam, and the one resolve-or-null kernel all three routers' auth
 * preambles build on.
 *
 * "Who is calling" and "how we find them" belong here, not inside any one routes
 * file: the contest, telemetry, and admin routers all depend on it. Each router
 * keeps its OWN reject behavior (contest/telemetry answer 401; admin answers a
 * deliberately-dark 404), so only the shared resolve step is centralized — the
 * divergent, security-sensitive rejection stays explicit per router.
 */
import type { Request } from 'express';

/** The authenticated caller. Email is denormalized into the events it produces. */
export interface AuthUser {
  id: string;
  email: string;
}

/** Resolves the authenticated user from a request, or null if none. */
export type ResolveUser = (req: Request) => Promise<AuthUser | null> | AuthUser | null;

/**
 * Resolves the caller, folding any resolver error into `null`. The common preamble
 * kernel; callers decide how to reject a null (401 vs a dark 404).
 */
export async function resolveUserOrNull(
  req: Request,
  resolveUser: ResolveUser,
): Promise<AuthUser | null> {
  try {
    return await resolveUser(req);
  } catch {
    return null;
  }
}
