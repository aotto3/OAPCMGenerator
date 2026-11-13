/**
 * App/server contract for custom email templates (PRD #320).
 *
 * Imports the server's pure rules module by relative path. Test-only: no
 * production code on either side may import across workspaces, since each
 * Railway service builds only its own. For the same reason this file is
 * excluded from app/tsconfig.json, so the frontend's deploy typecheck (which
 * has no server/ folder) passes.
 */
import { describe, expect, it } from 'vitest';
import * as server from '../../../server/src/emailTemplateRules';
import { TEMPLATE_LIMITS, templateNameKey, templateProblem, type TemplateInput } from './templateRules';

describe('template rules match the server', () => {
  it('limits are equal', () => {
    expect(TEMPLATE_LIMITS).toEqual(server.TEMPLATE_LIMITS);
  });

  it('names compare the same way', () => {
    for (const n of ['Hotel', '  hotel ', 'HÔTEL', '']) expect(templateNameKey(n)).toBe(server.templateNameKey(n));
  });

  it('both sides refuse the same inputs for the same reasons', () => {
    const ok: TemplateInput = { name: 'Thanks', subject: 's', body: 'b' };
    const cases: Array<[TemplateInput, string[], number]> = [
      [ok, [], 0],
      [{ ...ok, name: '  ' }, [], 0],
      [{ ...ok, name: 'n'.repeat(TEMPLATE_LIMITS.name) }, [], 0],
      [{ ...ok, name: 'n'.repeat(TEMPLATE_LIMITS.name + 1) }, [], 0],
      [{ ...ok, subject: 's'.repeat(TEMPLATE_LIMITS.subject + 1) }, [], 0],
      [{ ...ok, body: 'b'.repeat(TEMPLATE_LIMITS.body + 1) }, [], 0],
      [ok, [' THANKS'], 1],
      [ok, ['Other'], TEMPLATE_LIMITS.perAccount],
      [ok, ['Other'], TEMPLATE_LIMITS.perAccount - 1],
    ];
    for (const [input, names, count] of cases) {
      expect(templateProblem(input, names, count)).toBe(server.templateProblem(input, names, count));
    }
  });
});
