/**
 * Custom email template rules (PRD #320), as the server enforces them: size
 * limits, the per-account cap and unique names. The editor checks these before
 * saving so it can say what is wrong without a round trip; the server is the
 * authority and runs the same check on every write.
 *
 * The server's copy is `server/src/emailTemplateRules.ts`. Each Railway service
 * builds only its own workspace, so production code cannot share one module;
 * `contract.test.ts` imports the server's module by relative path and fails if
 * the two drift.
 */

export const TEMPLATE_LIMITS = {
  name: 80,
  subject: 200,
  body: 20000,
  perAccount: 50,
  /** The author name shown on a shared template. */
  authorName: 80,
} as const;

/**
 * The author name to share a template under: trimmed, or null when it is
 * blank, too long or not a string (sharing is refused).
 */
export function cleanAuthorName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return name === '' || name.length > TEMPLATE_LIMITS.authorName ? null : name;
}

/** What a CM saves: the template's own text. */
export interface TemplateInput {
  name: string;
  subject: string;
  body: string;
}

/** Why a template write is refused. */
export type TemplateProblem =
  | 'name_required'
  | 'name_too_long'
  | 'subject_too_long'
  | 'body_too_long'
  | 'duplicate_name'
  | 'too_many';

/** The key two names are compared by: trimmed, case-insensitive. */
export function templateNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The first problem with saving `input`, or null when it may be saved.
 * `otherNames` are the account's other template names; `otherCount` is how many
 * other templates it has.
 */
export function templateProblem(
  input: TemplateInput,
  otherNames: readonly string[],
  otherCount: number,
): TemplateProblem | null {
  const name = input.name.trim();
  if (name === '') return 'name_required';
  if (name.length > TEMPLATE_LIMITS.name) return 'name_too_long';
  if (input.subject.length > TEMPLATE_LIMITS.subject) return 'subject_too_long';
  if (input.body.length > TEMPLATE_LIMITS.body) return 'body_too_long';
  const key = templateNameKey(name);
  if (otherNames.some((n) => templateNameKey(n) === key)) return 'duplicate_name';
  if (otherCount >= TEMPLATE_LIMITS.perAccount) return 'too_many';
  return null;
}

/** The message the editor shows for a refused save. */
export function templateProblemMessage(problem: TemplateProblem): string {
  switch (problem) {
    case 'name_required':
      return 'Give the template a name.';
    case 'name_too_long':
      return `The name can be at most ${TEMPLATE_LIMITS.name} characters.`;
    case 'subject_too_long':
      return `The subject can be at most ${TEMPLATE_LIMITS.subject} characters.`;
    case 'body_too_long':
      return `The body can be at most ${TEMPLATE_LIMITS.body.toLocaleString('en-US')} characters.`;
    case 'duplicate_name':
      return 'You already have a template with this name. Choose another name.';
    case 'too_many':
      return `You can keep up to ${TEMPLATE_LIMITS.perAccount} templates. Delete one to add another.`;
  }
}
