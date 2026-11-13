/**
 * Custom email template rules (PRD #320): the size limits, the per-account cap,
 * name uniqueness, and the request-body shape check. Pure, no I/O.
 *
 * The app mirrors these in `app/src/templates/templateRules.ts` so the editor
 * can explain a refusal before saving; `app/src/templates/contract.test.ts`
 * imports this module by relative path and fails if the two sides drift. The
 * server is the authority: it runs the same check on every write.
 */

export const TEMPLATE_LIMITS = {
  name: 80,
  subject: 200,
  body: 20000,
  perAccount: 50,
} as const;

/** What a CM sends to create (or later, update) a template. */
export interface TemplateInput {
  name: string;
  subject: string;
  body: string;
}

/** Why a template write is refused. The app maps each to a message. */
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
 * Reads a request body into a template input, or null when the shape is wrong
 * (a missing or non-string field). The name is trimmed; subject and body are
 * kept exactly as typed.
 */
export function parseTemplateInput(raw: unknown): TemplateInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, subject, body } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || typeof subject !== 'string' || typeof body !== 'string') return null;
  return { name: name.trim(), subject, body };
}

/**
 * The first problem with saving `input`, or null when it may be saved.
 * `otherNames` are the account's other template names (for an edit, every name
 * but the template's own); `otherCount` is how many other templates it has.
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
