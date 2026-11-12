/**
 * Fire-and-forget client telemetry (Slice #58). Reports a small allowlisted set
 * of actions the server can't see itself — documents generated, contest file
 * export/import, uncaught client errors — to the authenticated telemetry
 * endpoint, which drops them into the same activity log the admin panel reads.
 *
 * The cardinal rule: telemetry is INVISIBLE and NON-BLOCKING. Every send
 * swallows all failures (offline, endpoint down, non-2xx) and no user-facing
 * path ever awaits one, so generating documents / exporting / importing can
 * never be slowed or broken by logging. This module is deliberately DOM-free so
 * it runs (and is unit-tested) in Node; the global error handlers that need
 * `window` live in errorReporting.ts.
 *
 * Only metadata is ever sent — contest ids/names and (for errors) a truncated
 * message plus the app version. Never contest contents, never credentials.
 */
import { createApi } from '../api/http';

/** App version stamped in at build time (see vite.config.ts). */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/**
 * Client-reportable event types. Must stay in lockstep with the server's
 * allowlist (server/src/eventTypes.ts TELEMETRY_EVENTS) — an unlisted type is
 * rejected there with a 400.
 */
export const TELEMETRY_TYPES = {
  documentsGenerated: 'documents.generated',
  contestExported: 'contest.exported',
  contestImported: 'contest.imported',
  clientError: 'client.error',
} as const;

/** Max client-error message length; longer messages are truncated before send. */
export const MAX_ERROR_MESSAGE = 1000;

export interface TelemetryPayload {
  type: string;
  contestId?: string;
  contestName?: string;
  detail?: unknown;
}

/** Truncates a client-error message to a safe length (with an ellipsis). */
export function truncateMessage(message: string): string {
  return message.length > MAX_ERROR_MESSAGE ? `${message.slice(0, MAX_ERROR_MESSAGE)}…` : message;
}

/** The detail blob for a client-error event: a truncated message + app version. */
export function clientErrorDetail(message: string): { message: string; appVersion: string } {
  return { message: truncateMessage(message), appVersion: APP_VERSION };
}

/**
 * A telemetry sender over an injectable fetch (tests). Each send posts one event
 * through the shared transport and swallows every failure: the returned promise
 * ALWAYS resolves (never rejects), so callers can safely `void` it and tests can
 * await it. `keepalive` lets a client-error report survive the page unload that
 * a crash may trigger.
 */
export function createTelemetryClient(fetchImpl?: typeof fetch) {
  const api = createApi(fetchImpl);
  return {
    send(payload: TelemetryPayload): Promise<void> {
      try {
        return api
          .send('POST', '/api/telemetry', payload, { keepalive: true })
          .then(() => undefined)
          .catch(() => undefined);
      } catch {
        // Guard even a synchronous throw: a report from inside an error handler
        // must never surface.
        return Promise.resolve();
      }
    },
  };
}

const defaultClient = createTelemetryClient();

/** Posts one event through the app's default sender; never rejects. */
export function sendTelemetry(payload: TelemetryPayload): Promise<void> {
  return defaultClient.send(payload);
}

/** Records that a user built (generated) the documents ZIP — the fact only. */
export function reportDocumentsGenerated(contestId?: string, contestName?: string): void {
  void sendTelemetry({ type: TELEMETRY_TYPES.documentsGenerated, contestId, contestName });
}

/** Records a contest-file export. */
export function reportContestExported(contestId?: string, contestName?: string): void {
  void sendTelemetry({ type: TELEMETRY_TYPES.contestExported, contestId, contestName });
}

/** Records a contest-file import. */
export function reportContestImported(contestId?: string, contestName?: string): void {
  void sendTelemetry({ type: TELEMETRY_TYPES.contestImported, contestId, contestName });
}

/** Records an uncaught client error (message truncated, app version attached). */
export function reportClientError(message: string): void {
  void sendTelemetry({ type: TELEMETRY_TYPES.clientError, detail: clientErrorDetail(message) });
}
