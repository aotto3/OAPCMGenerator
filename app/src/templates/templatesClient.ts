/**
 * The CM's custom email templates over the network (PRD #320), with a copy
 * kept on the device so the composer still has them offline (a venue with bad
 * Wi-Fi on contest day).
 *
 * Reads: `list()` asks the server and, on success, replaces the device copy;
 * when the server cannot be reached (or answers with an error) it returns the
 * device copy instead, marked as such. `saved()` returns the device copy at
 * once, so the composer can show the buttons before the network answers.
 *
 * Writes need a connection: they go straight to the server and the device copy
 * changes only after the server accepts. Offline, nothing changes and the
 * result says so.
 *
 * The device copy is keyed by account, so two CMs sharing a computer never see
 * each other's templates. It lives in localStorage, never IndexedDB (only the
 * contest library touches IndexedDB). Every storage access is guarded: a
 * private window or blocked storage just means no device copy.
 */
import { ApiHttpError, ApiNetworkError, createApi } from '../api/http';
import type { TemplateInput, TemplateProblem } from './templateRules';

/** A template as the server stores it. */
export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** In the gallery. Absent on a device copy saved before sharing existed. */
  shared?: boolean;
  /** When it was shared; null or absent while private. */
  sharedAt?: string | null;
}

/** A shared template as the gallery shows it. Never carries who owns it beyond `mine`. */
export interface GalleryTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  authorName: string;
  sharedAt: string;
  /** True when the signed-in CM wrote it. */
  mine: boolean;
}

export type GalleryResult = { kind: 'ok'; templates: GalleryTemplate[] } | { kind: 'offline' } | { kind: 'error' };

export type ShareResult =
  | { kind: 'saved'; template: EmailTemplate }
  | { kind: 'offline' }
  /** The author name was blank or too long. */
  | { kind: 'no_author' }
  | { kind: 'not_found' }
  | { kind: 'error' };

/** Adding from the gallery: a create, or the template is no longer shared. */
export type AddResult = CreateResult | { kind: 'not_found' };

/** Where `list()` got its answer. */
export type ListResult =
  | { kind: 'server'; templates: EmailTemplate[] }
  /** The server could not be reached or failed; this is the device copy. */
  | { kind: 'device'; templates: EmailTemplate[] };

export type CreateResult =
  | { kind: 'saved'; template: EmailTemplate }
  | { kind: 'offline' }
  | { kind: 'invalid'; problem: TemplateProblem }
  | { kind: 'error' };

/** An edit: like a create, plus the template no longer existing (deleted on another device). */
export type UpdateResult = CreateResult | { kind: 'not_found' };

export type DeleteResult = { kind: 'deleted' } | { kind: 'offline' } | { kind: 'error' };

/** The slice of the Storage API the device copy needs (injectable for tests). */
export interface DeviceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PROBLEMS: ReadonlySet<string> = new Set<TemplateProblem>([
  'name_required',
  'name_too_long',
  'subject_too_long',
  'body_too_long',
  'duplicate_name',
  'too_many',
]);

const BASE = '/api/templates';

/** The device-copy key for an account. */
export function deviceKey(userId: string): string {
  return `oap.emailTemplates.${userId}`;
}

function isGalleryTemplate(t: unknown): t is GalleryTemplate {
  if (typeof t !== 'object' || t === null) return false;
  const r = t as Record<string, unknown>;
  return (
    ['id', 'name', 'subject', 'body', 'authorName', 'sharedAt'].every((k) => typeof r[k] === 'string') &&
    typeof r.mine === 'boolean'
  );
}

function isTemplate(t: unknown): t is EmailTemplate {
  if (typeof t !== 'object' || t === null) return false;
  const r = t as Record<string, unknown>;
  return ['id', 'name', 'subject', 'body', 'createdAt', 'updatedAt'].every((k) => typeof r[k] === 'string');
}

function browserStorage(): DeviceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export interface TemplatesClientOptions {
  /** The signed-in account; the device copy is kept per account. */
  userId: string;
  fetchImpl?: typeof fetch;
  /** Defaults to the browser's localStorage; null means no device copy. */
  storage?: DeviceStorage | null;
}

export function createTemplatesClient(options: TemplatesClientOptions) {
  const api = createApi(options.fetchImpl);
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const key = deviceKey(options.userId);

  function saved(): EmailTemplate[] {
    try {
      const raw = storage?.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isTemplate) : [];
    } catch {
      return [];
    }
  }

  function keep(templates: EmailTemplate[]): void {
    try {
      storage?.setItem(key, JSON.stringify(templates));
    } catch {
      /* best-effort: no device copy this time */
    }
  }

  /** Maps a failed write to its result. */
  function writeFailure(err: unknown): { kind: 'offline' } | { kind: 'invalid'; problem: TemplateProblem } | { kind: 'error' } {
    if (err instanceof ApiNetworkError) return { kind: 'offline' };
    if (err instanceof ApiHttpError && err.status === 400) {
      const problem = (err.body as { error?: unknown } | undefined)?.error;
      if (typeof problem === 'string' && PROBLEMS.has(problem)) {
        return { kind: 'invalid', problem: problem as TemplateProblem };
      }
    }
    return { kind: 'error' };
  }

  /** Puts a saved template into the device copy, replacing its old version in place. */
  function keepOne(template: EmailTemplate): void {
    const current = saved();
    const at = current.findIndex((t) => t.id === template.id);
    keep(at === -1 ? [...current, template] : current.map((t) => (t.id === template.id ? template : t)));
  }

  return {
    /** The device copy, at once; [] when there is none. */
    saved,

    async list(): Promise<ListResult> {
      try {
        const body = await api.get<{ templates?: unknown }>(BASE);
        const templates = Array.isArray(body?.templates) ? body.templates.filter(isTemplate) : null;
        if (!templates) return { kind: 'device', templates: saved() };
        keep(templates);
        return { kind: 'server', templates };
      } catch {
        return { kind: 'device', templates: saved() };
      }
    },

    async create(input: TemplateInput): Promise<CreateResult> {
      try {
        const body = await api.send<{ template?: unknown }>('POST', BASE, input);
        if (!isTemplate(body?.template)) return { kind: 'error' };
        keepOne(body.template);
        return { kind: 'saved', template: body.template };
      } catch (err) {
        return writeFailure(err);
      }
    },

    /**
     * Replaces a template (last write wins). For a shared template, pass the
     * author name so the gallery card shows the current one.
     */
    async update(id: string, input: TemplateInput, authorName?: string): Promise<UpdateResult> {
      try {
        const body = await api.send<{ template?: unknown }>(
          'PUT',
          `${BASE}/${encodeURIComponent(id)}`,
          authorName ? { ...input, authorName } : input,
        );
        if (!isTemplate(body?.template)) return { kind: 'error' };
        keepOne(body.template);
        return { kind: 'saved', template: body.template };
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 404) {
          // Gone on the server (deleted elsewhere): drop it here too.
          keep(saved().filter((t) => t.id !== id));
          return { kind: 'not_found' };
        }
        return writeFailure(err);
      }
    },

    /** Shares a template under `authorName`, or takes it back out of the gallery when `authorName` is null. */
    async setShared(id: string, authorName: string | null): Promise<ShareResult> {
      const path = `${BASE}/${encodeURIComponent(id)}/share`;
      try {
        const body = await (authorName === null
          ? api.send<{ template?: unknown }>('DELETE', path)
          : api.send<{ template?: unknown }>('POST', path, { authorName }));
        if (!isTemplate(body?.template)) return { kind: 'error' };
        keepOne(body.template);
        return { kind: 'saved', template: body.template };
      } catch (err) {
        if (err instanceof ApiNetworkError) return { kind: 'offline' };
        if (err instanceof ApiHttpError && err.status === 404) return { kind: 'not_found' };
        if (err instanceof ApiHttpError && err.status === 400) return { kind: 'no_author' };
        return { kind: 'error' };
      }
    },

    /** Every shared template. Online only: the gallery is not kept on the device. */
    async gallery(): Promise<GalleryResult> {
      try {
        const body = await api.get<{ templates?: unknown }>(`${BASE}/gallery`);
        if (!Array.isArray(body?.templates)) return { kind: 'error' };
        return { kind: 'ok', templates: body.templates.filter(isGalleryTemplate) };
      } catch (err) {
        return err instanceof ApiNetworkError ? { kind: 'offline' } : { kind: 'error' };
      }
    },

    /** Copies a shared template into this account, optionally under a new name. */
    async addFromGallery(id: string, name?: string): Promise<AddResult> {
      try {
        const body = await api.send<{ template?: unknown }>(
          'POST',
          `${BASE}/gallery/${encodeURIComponent(id)}/add`,
          name === undefined ? {} : { name },
        );
        if (!isTemplate(body?.template)) return { kind: 'error' };
        keepOne(body.template);
        return { kind: 'saved', template: body.template };
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 404) return { kind: 'not_found' };
        return writeFailure(err);
      }
    },

    /** Deletes a template. Already gone on the server counts as deleted. */
    async remove(id: string): Promise<DeleteResult> {
      try {
        await api.send('DELETE', `${BASE}/${encodeURIComponent(id)}`);
      } catch (err) {
        if (!(err instanceof ApiHttpError && err.status === 404)) {
          return err instanceof ApiNetworkError ? { kind: 'offline' } : { kind: 'error' };
        }
      }
      keep(saved().filter((t) => t.id !== id));
      return { kind: 'deleted' };
    },
  };
}

export type TemplatesClient = ReturnType<typeof createTemplatesClient>;
