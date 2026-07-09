/**
 * Global uncaught-error reporting (Slice #58, PRD user story 8). Registers
 * window handlers for uncaught errors and unhandled promise rejections and
 * feeds each into a client-error telemetry event, so the owner learns about
 * breakage from the admin feed before a user emails about it.
 *
 * Split from telemetryClient.ts (which stays DOM-free and unit-tested) because
 * this half needs `window`. It is best-effort like all telemetry: reporting a
 * crash must never itself throw or interfere with the browser's own handling.
 */
import { reportClientError } from './telemetryClient';

/** Best-effort "Name: message" from whatever an error handler was handed. */
function describe(value: unknown, fallback: string): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string' && value.trim() !== '') return value;
  return fallback;
}

/** Registers the global error/rejection handlers. Call once, at startup. */
export function installGlobalErrorReporting(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event: ErrorEvent) => {
    try {
      reportClientError(describe(event.error, event.message || 'Uncaught error'));
    } catch {
      // Never let error reporting throw from inside an error handler.
    }
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    try {
      reportClientError(describe(event.reason, 'Unhandled promise rejection'));
    } catch {
      // Same: swallow anything reporting might throw.
    }
  });
}
