/**
 * Environment configuration. Kept in one place so every secret and URL the
 * server needs is documented (see .env.example) and read exactly once.
 *
 * Nothing here throws at import time — callers decide when a value is
 * required. That keeps the pure modules (payload validation, the app factory
 * with an injected auth resolver) and the test suite runnable with no secrets
 * set; only the production entrypoint and the auth instance demand real values.
 */

/** Returns a required env var or throws a clear error naming it. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Returns an optional env var, or the fallback when unset/empty. */
export function optionalEnv(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** Port Railway (or local dev) tells us to listen on. */
export const port = (): number => Number(process.env.PORT) || 8080;
