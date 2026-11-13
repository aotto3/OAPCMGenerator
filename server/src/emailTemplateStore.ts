/**
 * Storage for custom email templates (PRD #320). Owner-scoped like the contest
 * repo and the questionnaire store: every owner query names the owner, so one
 * account can never read or change another's templates. Pool-injected so the
 * tests run on pg-mem.
 *
 * The rules (limits, unique names, the per-account cap) live in
 * `emailTemplateRules.ts`; every write applies them against the account's
 * current templates and stores nothing when one fails.
 *
 * Sharing (slice #325). A template is private until its owner shares it, with
 * an author name the app supplies (the CM name from the open contest). The
 * gallery is the ONE cross-account read: `listShared` returns shared templates
 * only, and only the fields a gallery card shows. It never returns an owner id
 * or email; whether a card is the viewer's own is computed here as a boolean.
 * Adding from the gallery copies a shared row into the adder's account as a new
 * private template with no link back to the original.
 *
 * Moderation (slice #326) is the admin's: `listSharedForAdmin` adds the owner id
 * to each gallery card, and `adminUnshare` takes any template out of the gallery
 * without touching the author's template. Only the admin routes call these.
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
  /** Whether it is in the gallery. */
  shared: boolean;
  /** When it was shared; null while private. */
  sharedAt: string | null;
}

/** A gallery card: what any signed-in CM may see of a shared template. */
export interface GalleryTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  /** The author's name as of their last share or save. */
  authorName: string;
  sharedAt: string;
  /** True when the viewer is the author. */
  mine: boolean;
}

export type CreateTemplateResult = { kind: 'created'; template: EmailTemplate } | { kind: 'invalid'; problem: TemplateProblem };

export type UpdateTemplateResult =
  | { kind: 'updated'; template: EmailTemplate }
  | { kind: 'not_found' }
  | { kind: 'invalid'; problem: TemplateProblem };

export type DeleteTemplateResult = { kind: 'deleted'; template: EmailTemplate } | { kind: 'not_found' };

export type ShareTemplateResult = { kind: 'updated'; template: EmailTemplate } | { kind: 'not_found' };

/** A gallery entry as the admin sees it: the card plus who owns it. */
export interface AdminSharedTemplate extends Omit<GalleryTemplate, 'mine'> {
  ownerId: string;
}

export interface EmailTemplateStore {
  /** The owner's templates, oldest first (the order their buttons appear in). */
  list(ownerId: string): Promise<EmailTemplate[]>;
  /** Creates a private template after checking the rules against the owner's others. */
  create(ownerId: string, input: TemplateInput, at: string): Promise<CreateTemplateResult>;
  /**
   * Replaces one of the owner's templates (last write wins), checking the rules
   * against the owner's OTHER templates. Sharing is kept; when the template is
   * shared and `authorName` is given, the gallery's author name is refreshed.
   * Another owner's id is not_found.
   */
  update(
    ownerId: string,
    id: string,
    input: TemplateInput,
    at: string,
    authorName?: string,
  ): Promise<UpdateTemplateResult>;
  /** Deletes one of the owner's templates (and so its gallery entry). Another owner's id is not_found. */
  remove(ownerId: string, id: string): Promise<DeleteTemplateResult>;
  /** Shares one of the owner's templates under `authorName` (already validated), or refreshes the name. */
  share(ownerId: string, id: string, authorName: string, at: string): Promise<ShareTemplateResult>;
  /** Takes one of the owner's templates out of the gallery. */
  unshare(ownerId: string, id: string): Promise<ShareTemplateResult>;
  /** Every shared template, newest share first, as gallery cards for `viewerId`. */
  listShared(viewerId: string): Promise<GalleryTemplate[]>;
  /** Admin only: every shared template with its owner id, newest share first. */
  listSharedForAdmin(): Promise<AdminSharedTemplate[]>;
  /**
   * Admin only: takes a shared template out of the gallery, whoever owns it.
   * The author keeps the template (now private). not_found when it is missing
   * or not shared.
   */
  adminUnshare(id: string): Promise<{ kind: 'removed'; name: string; ownerId: string } | { kind: 'not_found' }>;
  /**
   * Copies a SHARED template into `ownerId`'s account as a new private template
   * named `name` (default: the original's name), under the usual rules. A
   * private or missing source is not_found.
   */
  addFromGallery(
    ownerId: string,
    sourceId: string,
    name: string | undefined,
    at: string,
  ): Promise<CreateTemplateResult | { kind: 'not_found' }>;
}

interface Row {
  id: string;
  owner_id: string;
  name: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
  shared: boolean;
  shared_at: string | null;
  author_name: string | null;
}

const COLUMNS = 'id, owner_id, name, subject, body, created_at, updated_at, shared, shared_at, author_name';

const toTemplate = (r: Row): EmailTemplate => ({
  id: r.id,
  name: r.name,
  subject: r.subject,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  shared: r.shared === true,
  sharedAt: r.shared ? r.shared_at : null,
});

export function createEmailTemplateStore(pool: Pool, newId: () => string = randomUUID): EmailTemplateStore {
  async function rows(ownerId: string): Promise<Row[]> {
    const { rows: found } = await pool.query(
      `select ${COLUMNS} from email_templates where owner_id = $1 order by created_at, id`,
      [ownerId],
    );
    return found as Row[];
  }

  async function one(ownerId: string, id: string): Promise<Row | undefined> {
    const { rows: found } = await pool.query(`select ${COLUMNS} from email_templates where owner_id = $1 and id = $2`, [
      ownerId,
      id,
    ]);
    return (found as Row[])[0];
  }

  async function create(ownerId: string, input: TemplateInput, at: string): Promise<CreateTemplateResult> {
    const existing = await rows(ownerId);
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
      shared: false,
      sharedAt: null,
    };
    await pool.query(
      `insert into email_templates (id, owner_id, name, subject, body, created_at, updated_at, shared)
       values ($1, $2, $3, $4, $5, $6, $7, false)`,
      [template.id, ownerId, template.name, template.subject, template.body, at, at],
    );
    return { kind: 'created', template };
  }

  return {
    async list(ownerId) {
      return (await rows(ownerId)).map(toTemplate);
    },

    create,

    async update(ownerId, id, input, at, authorName) {
      const existing = await rows(ownerId);
      const current = existing.find((t) => t.id === id);
      if (!current) return { kind: 'not_found' };
      const others = existing.filter((t) => t.id !== id);
      const problem = templateProblem(
        input,
        others.map((t) => t.name),
        others.length,
      );
      if (problem) return { kind: 'invalid', problem };
      const author = current.shared && authorName ? authorName : current.author_name;
      const name = input.name.trim();
      await pool.query(
        `update email_templates set name = $3, subject = $4, body = $5, updated_at = $6, author_name = $7
         where owner_id = $1 and id = $2`,
        [ownerId, id, name, input.subject, input.body, at, author],
      );
      return {
        kind: 'updated',
        template: toTemplate({ ...current, name, subject: input.subject, body: input.body, updated_at: at }),
      };
    },

    async remove(ownerId, id) {
      const current = await one(ownerId, id);
      if (!current) return { kind: 'not_found' };
      await pool.query('delete from email_templates where owner_id = $1 and id = $2', [ownerId, id]);
      return { kind: 'deleted', template: toTemplate(current) };
    },

    async share(ownerId, id, authorName, at) {
      const current = await one(ownerId, id);
      if (!current) return { kind: 'not_found' };
      // Re-sharing keeps the original share date; only the author name refreshes.
      const sharedAt = current.shared && current.shared_at ? current.shared_at : at;
      await pool.query(
        `update email_templates set shared = true, shared_at = $3, author_name = $4 where owner_id = $1 and id = $2`,
        [ownerId, id, sharedAt, authorName],
      );
      return { kind: 'updated', template: toTemplate({ ...current, shared: true, shared_at: sharedAt }) };
    },

    async unshare(ownerId, id) {
      const current = await one(ownerId, id);
      if (!current) return { kind: 'not_found' };
      await pool.query(`update email_templates set shared = false, shared_at = null where owner_id = $1 and id = $2`, [
        ownerId,
        id,
      ]);
      return { kind: 'updated', template: toTemplate({ ...current, shared: false, shared_at: null }) };
    },

    async listShared(viewerId) {
      const { rows: found } = await pool.query(
        `select ${COLUMNS} from email_templates where shared = true order by shared_at desc, id`,
      );
      return (found as Row[]).map((r) => ({
        id: r.id,
        name: r.name,
        subject: r.subject,
        body: r.body,
        authorName: r.author_name ?? '',
        sharedAt: r.shared_at ?? '',
        mine: r.owner_id === viewerId,
      }));
    },

    async listSharedForAdmin() {
      const { rows: found } = await pool.query(
        `select ${COLUMNS} from email_templates where shared = true order by shared_at desc, id`,
      );
      return (found as Row[]).map((r) => ({
        id: r.id,
        name: r.name,
        subject: r.subject,
        body: r.body,
        authorName: r.author_name ?? '',
        sharedAt: r.shared_at ?? '',
        ownerId: r.owner_id,
      }));
    },

    async adminUnshare(id) {
      const { rows: found } = await pool.query(`select ${COLUMNS} from email_templates where id = $1 and shared = true`, [
        id,
      ]);
      const current = (found as Row[])[0];
      if (!current) return { kind: 'not_found' };
      await pool.query(`update email_templates set shared = false, shared_at = null where id = $1`, [id]);
      return { kind: 'removed', name: current.name, ownerId: current.owner_id };
    },

    async addFromGallery(ownerId, sourceId, name, at) {
      const { rows: found } = await pool.query(`select ${COLUMNS} from email_templates where id = $1 and shared = true`, [
        sourceId,
      ]);
      const source = (found as Row[])[0];
      if (!source) return { kind: 'not_found' };
      return create(ownerId, { name: name ?? source.name, subject: source.subject, body: source.body }, at);
    },
  };
}
