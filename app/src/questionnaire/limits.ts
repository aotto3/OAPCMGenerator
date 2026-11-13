/**
 * The judge questionnaire's size limits, as the server enforces them (RFC #270).
 *
 * The server's copies live in `server/src/judgeRoster.ts` (`ANSWER_LIMITS`,
 * `MAX_ROSTER_FIELD_LENGTH`). Each Railway service builds only its own workspace,
 * so production code cannot share one module; `contract.test.ts` imports the
 * server's constants by relative path and fails if the two sides drift.
 */

/** Per-field length caps for the free-text questionnaire answers. */
export const ANSWER_LIMITS = {
  cellPhone: 40,
  mailingAddress: 400,
  dietary: 1000,
  bio: 4000,
  notes: 4000,
} as const;

/** Longest string any judge roster field may hold. */
export const MAX_ROSTER_FIELD_LENGTH = 320;
