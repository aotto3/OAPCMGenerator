/**
 * The telemetry event types the client may report, as a fixed allowlist. The
 * telemetry endpoint rejects anything not in this set (PRD user story 21: the
 * log can't be polluted with client-invented entries), and the admin stats read
 * the documents-generated type from here so the two never drift.
 *
 * These sit alongside the server-authored `contest.*` events the contest routes
 * record directly; only the ones below are accepted from the browser.
 */
export const TELEMETRY_EVENTS = {
  documentsGenerated: 'documents.generated',
  contestExported: 'contest.exported',
  contestImported: 'contest.imported',
  clientError: 'client.error',
} as const;

export type TelemetryEventType = (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS];

/** Membership set for validating an incoming telemetry event type. */
export const TELEMETRY_EVENT_TYPES: ReadonlySet<string> = new Set(Object.values(TELEMETRY_EVENTS));

/** Counted for the admin "documents generated" stat. */
export const DOCUMENTS_GENERATED_EVENT = TELEMETRY_EVENTS.documentsGenerated;
