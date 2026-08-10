/**
 * The activity-log event vocabulary — one home for every event-type string the
 * server and client produce, so no name is written as a bare literal at a second
 * site (a rename here can't silently desync the analytics that count it).
 *
 * TWO DISTINCT GROUPS, and the split is a security boundary:
 *  - TELEMETRY_EVENTS are the ONLY types the browser may report; the telemetry
 *    endpoint validates against TELEMETRY_EVENT_TYPES and 400s anything else, so a
 *    client can't inject a server-authored 'contest.created' (PRD user story 21).
 *  - CONTEST_EVENTS and ADMIN_EVENTS are recorded by the server itself (contest
 *    writes, the admin resend action) and are never accepted from a client.
 */

/** Events the browser may report via the telemetry endpoint (the client allowlist). */
export const TELEMETRY_EVENTS = {
  documentsGenerated: 'documents.generated',
  contestExported: 'contest.exported',
  contestImported: 'contest.imported',
  clientError: 'client.error',
} as const;

/** Events the server records itself on contest writes — never client-reportable. */
export const CONTEST_EVENTS = {
  created: 'contest.created',
  updated: 'contest.updated',
  deleted: 'contest.deleted',
} as const;

/** Events the server records for owner/admin actions — never client-reportable. */
export const ADMIN_EVENTS = {
  signInLinkResent: 'admin.signin_link_resent',
} as const;

export type TelemetryEventType = (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS];

/**
 * Membership set the telemetry endpoint validates an incoming type against —
 * TELEMETRY_EVENTS only. Deliberately NOT widened with the server-authored
 * groups: that separation is what stops a client from writing a 'contest.*' or
 * 'admin.*' row.
 */
export const TELEMETRY_EVENT_TYPES: ReadonlySet<string> = new Set(Object.values(TELEMETRY_EVENTS));

/** Counted for the admin "documents generated" stat. */
export const DOCUMENTS_GENERATED_EVENT = TELEMETRY_EVENTS.documentsGenerated;
