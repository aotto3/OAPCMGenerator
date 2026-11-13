/**
 * The activity-log event vocabulary — one home for every event-type string the
 * server and client produce, so no name is written as a bare literal at a second
 * site (a rename here can't silently desync the analytics that count it).
 *
 * TWO DISTINCT GROUPS, and the split is a security boundary:
 *  - TELEMETRY_EVENTS are the ONLY types the browser may report; the telemetry
 *    endpoint validates against TELEMETRY_EVENT_TYPES and 400s anything else, so a
 *    client can't inject a server-authored 'contest.created' (PRD user story 21).
 *  - CONTEST_EVENTS, ADMIN_EVENTS, QUESTIONNAIRE_EVENTS and TEMPLATE_EVENTS are
 *    recorded by the server itself (contest writes, the admin resend action, the
 *    public judge questionnaire, email template writes) and are never accepted
 *    from a client.
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
  /** The admin took a shared email template out of the gallery (PRD #320). */
  templateRemovedFromGallery: 'admin.template_removed_from_gallery',
} as const;

/**
 * Events the server records on the public judge questionnaire (#261), filed
 * under the CM whose link was used — never client-reportable.
 */
export const QUESTIONNAIRE_EVENTS = {
  judgeFound: 'questionnaire.judge_found',
  submitted: 'questionnaire.submitted',
  notOnRoster: 'questionnaire.not_on_roster',
  rateLimited: 'questionnaire.rate_limited',
  honeypot: 'questionnaire.honeypot',
} as const;

/**
 * Events the server records on a CM's custom email templates (PRD #320), by
 * template name only, never the body. Never client-reportable.
 */
export const TEMPLATE_EVENTS = {
  created: 'template.created',
  updated: 'template.updated',
  deleted: 'template.deleted',
  shared: 'template.shared',
  unshared: 'template.unshared',
  addedFromGallery: 'template.added_from_gallery',
} as const;

export type QuestionnaireEventType =(typeof QUESTIONNAIRE_EVENTS)[keyof typeof QUESTIONNAIRE_EVENTS];

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
