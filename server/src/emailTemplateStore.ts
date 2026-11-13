/**
 * Storage for custom email templates (PRD #320). Owner-scoped like the contest
 * repo and the questionnaire store: every query names the owner, so one account
 * can never read or change another's templates. Pool-injected so the tests run
 * on pg-mem.
 *
 * The rules (limits, unique names, the per-account cap) live in
 * `emailTemplateRules.ts`; `create` applies them against the account's current
 * templates and stores nothing when one fails.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from './db';
import { templateProblem, type TemplateInput, type TemplateProblem } from './emailTemplateRules';

/** A template as its owner sees it. */
export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateTemplateResult = { kind: 'created'; template: EmailTemplate } | { kind: 'invalid'; problem: TemplateProblem };

export type UpdateTemplateResult =
  | { kind: 'updated'; template: EmailTemplate }
  | { kind: 'not_found' }
  | { kind: 'invalid'; problem: TemplateProblem };

export type DeleteTemplateResult = { kind: 'deleted'; template: EmailTemplate } | { kind: 'not_found' };

export interface EmailTemplateStore {
  /** The owner's templates, oldest first (the order their buttons appear in). */
  list(ownerId: string): Promise<EmailTemplate[]>;
  /** Creates a template after checking the rules against the owner's others. */
  create(ownerId: string, input: TemplateInput, at: string): Promise<CreateTemplateResult>;
  /**
   * Replaces one of the owner's templates (last write wins), checking the rules
   * against the owner's OTHER templates. Another owner's id is not_found.
   */
  update(ownerId: string, id: string, input: TemplateInput, at: string): Promise<UpdateTemplateResult>;
  /** Deletes one of the owner's templates; returns what was deleted. Another owner's id is not_found. */
  remove(ownerId: string, id: string): Promise<DeleteTemplateResult>;
}

interface Row {
  id: string;
  name: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
}

const toTemplate = (r: Row): EmailTemplate => ({
  id: r.id,
  name: r.name,
  subject: r.subject,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createEmailTemplateStore(pool: Pool, newId: () => string = randomUUID): EmailTemplateStore {
  async function list(ownerId: string): Promise<EmailTemplate[]> {
    const { rows } = await pool.query(
      `select id, name, subject, body, created_at, updated_at from email_templates
       where owner_id = $1 order by created_at, id`,
      [ownerId],
    );
    return (rows as Row[]).map(toTemplate);
  }

  return {
    list,

    async create(ownerId, input, at) {
      const existing = await list(ownerId);
      const problem = templateProblem(
        input,
        existing.map((t) => t.name),
        existing.length,
      );
      if (problem) return { kind: 'invalid', problem };
      const template: EmailTemplate = {
        id: newId(),
        name: input.name.trim(),
        subject: input.subject,
        body: input.body,
        createdAt: at,
        updatedAt: at,
      };
      await pool.query(
        `insert into email_templates (id, owner_id, name, subject, body, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [template.id, ownerId, template.name, template.subject, template.body, at, at],
      );
      return { kind: 'created', template };
    },

    async update(ownerId, id, input, at) {
      const existing = await list(ownerId);
      const current = existing.find((t) => t.id === id);
      if (!current) return { kind: 'not_found' };
      const others = existing.filter((t) => t.id !== id);
      const problem = templateProblem(
        input,
        others.map((t) => t.name),
        others.length,
      );
      if (problem) return { kind: 'invalid', problem };
      const template: EmailTemplate = {
        ...current,
        name: input.name.trim(),
        subject: input.subject,
        body: input.body,
        updatedAt: at,
      };
      await pool.query(
        `update email_templates set name = $3, subject = $4, body = $5, updated_at = $6
         where owner_id = $1 and id = $2`,
        [ownerId, id, template.name, template.subject, template.body, at],
      );
      return { kind: 'updated', template };
    },

    async remove(ownerId, id) {
      const current = (await list(ownerId)).find((t) => t.id === id);
      if (!current) return { kind: 'not_found' };
      await pool.query('delete from email_templates where owner_id = $1 and id = $2', [ownerId, id]);
      return { kind: 'deleted', template: current };
    },
  };
}
