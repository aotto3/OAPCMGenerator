import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../auth/authClient';
import type { Contest } from '../model/contest';
import { createQuestionnaireClient, questionnaireUrl } from '../questionnaire/questionnaireClient';
import {
  MERGE_FIELDS,
  mergeTag,
  QUESTIONNAIRE_LINK_FIELD,
  renderTemplate,
  usesField,
} from '../templates/templateRender';
import { STARTERS, starterInput } from '../templates/starters';
import {
  TEMPLATE_LIMITS,
  templateProblem,
  templateProblemMessage,
  type TemplateInput,
} from '../templates/templateRules';
import { offerUndo } from './undoOffer';
import { createTemplatesClient, type EmailTemplate, type TemplatesClient } from '../templates/templatesClient';

const questionnaireClient = createQuestionnaireClient();

/** The editor for a template not saved yet, with the text it starts from. */
interface NewTemplate {
  start: TemplateInput;
}

/** The "Blank template" option's value (the placeholder option is ''). */
const BLANK = '__blank__';

/**
 * The CM's own email templates in the Email Draft Composer (PRD #320): a "My
 * templates" button row under the built-ins, a "+ New template" chooser (blank,
 * or a copy of a built-in email written in merge fields), and edit and delete
 * on each template.
 *
 * Templates belong to the account, not the contest, so the same row appears in
 * every contest. Clicking one fills the composer's subject and body from the
 * open contest (renderTemplate) and leaves the To: line empty; the CM adds
 * recipients. The list shows the device copy at once, then the server's answer;
 * saving and deleting need a connection. A delete asks first, then offers Undo
 * through the workspace's Undo toast, which re-creates the template.
 */
export function MyTemplates({
  contest,
  onLoad,
}: {
  contest: Contest;
  /** Puts a filled draft into the composer. */
  onLoad: (draft: { subject: string; body: string }) => void;
}) {
  const { data: session } = useSession();
  const userId = session?.user.id;
  // The client is per account (its device copy is keyed by account).
  const client = useMemo<TemplatesClient | null>(() => (userId ? createTemplatesClient({ userId }) : null), [userId]);

  const [templates, setTemplates] = useState<EmailTemplate[]>(() => client?.saved() ?? []);
  /** True when the last list came from the device copy because the server could not be reached. */
  const [fromDevice, setFromDevice] = useState(false);
  /** The editor: closed, a new template, or the template being edited. */
  const [editing, setEditing] = useState<null | NewTemplate | EmailTemplate>(null);
  /** Why the last delete failed, shown under the row. */
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let live = true;
    setTemplates(client.saved());
    void client.list().then((result) => {
      if (!live) return;
      setTemplates(result.templates);
      setFromDevice(result.kind === 'device');
    });
    return () => {
      live = false;
    };
  }, [client]);

  /**
   * The account's questionnaire link, fetched the first time a template uses
   * {{questionnaireLink}}: undefined until asked, null when it could not be
   * loaded (offline), so the field shows its paste-here placeholder.
   */
  const [questionnaireLink, setQuestionnaireLink] = useState<string | null | undefined>(undefined);
  const linkRequest = useRef<Promise<string | null> | null>(null);

  function ensureQuestionnaireLink(): Promise<string | null> {
    linkRequest.current ??= questionnaireClient
      .getLinkToken()
      .then((token) => questionnaireUrl(window.location.origin, token))
      .catch(() => {
        // Let a later use try again (the CM may be back online).
        linkRequest.current = null;
        return null;
      })
      .then((link) => {
        setQuestionnaireLink(link);
        return link;
      });
    return linkRequest.current;
  }

  if (!client) return null;
  const templatesClient = client;

  async function load(t: EmailTemplate) {
    const link = usesField(t, QUESTIONNAIRE_LINK_FIELD) ? await ensureQuestionnaireLink() : null;
    const filled = renderTemplate(t, contest, { questionnaireLink: link });
    onLoad({ subject: filled.subject, body: filled.body });
  }

  async function remove(t: EmailTemplate) {
    if (!window.confirm(`Delete your template "${t.name}"?`)) return;
    setRowError(null);
    const result = await templatesClient.remove(t.id);
    if (result.kind !== 'deleted') {
      setRowError(
        result.kind === 'offline'
          ? 'You’re offline, so the template was not deleted. Try again when you’re connected.'
          : 'The template could not be deleted. Try again.',
      );
      return;
    }
    setTemplates((prev) => prev.filter((p) => p.id !== t.id));
    setEditing((e) => (e !== null && 'id' in e && e.id === t.id ? null : e));
    offerUndo({
      message: `Template “${t.name}” deleted`,
      contestId: contest.id,
      failMessage: `Couldn’t bring back “${t.name}”. Check your connection.`,
      undo: async () => {
        const back = await templatesClient.create({ name: t.name, subject: t.subject, body: t.body });
        if (back.kind !== 'saved') throw new Error(`Undo failed: ${back.kind}`);
        setTemplates((prev) => [...prev, back.template]);
      },
    });
  }

  const editingTemplate = editing !== null && 'id' in editing ? editing : null;
  const newStart = editing !== null && !('id' in editing) ? editing.start : null;

  /** Opens the editor for a new template: '' for blank, else a built-in starter's id. */
  function startNew(choice: string) {
    const starter = STARTERS.find((st) => st.id === choice);
    setEditing({
      start: starter
        ? starterInput(
            starter,
            templates.map((t) => t.name),
          )
        : { name: '', subject: '', body: '' },
    });
  }

  return (
    <div className="my-templates">
      <div className="my-templates-head">
        <strong>My templates</strong>
        <span className="hint">Yours in every contest. Recipients are left for you to add.</span>
      </div>
      <div className="email-template-row">
        {templates.map((t) => (
          <span key={t.id} className="my-template">
            <button type="button" className="email-template-btn my-template-btn" onClick={() => void load(t)}>
              {t.name}
            </button>
            <button
              type="button"
              className="my-template-icon"
              aria-label={`Edit ${t.name}`}
              title="Edit"
              onClick={() => setEditing(t)}
            >
              ✎
            </button>
            <button
              type="button"
              className="my-template-icon"
              aria-label={`Delete ${t.name}`}
              title="Delete"
              onClick={() => void remove(t)}
            >
              ✕
            </button>
          </span>
        ))}
        {editing === null && (
          <select
            className="template-new-picker"
            aria-label="New template"
            value=""
            onChange={(e) => startNew(e.target.value === BLANK ? '' : e.target.value)}
          >
            <option value="" disabled hidden>
              + New template…
            </option>
            <option value={BLANK}>Blank template</option>
            <optgroup label="Copy a built-in email">
              {STARTERS.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </optgroup>
          </select>
        )}
      </div>
      {fromDevice && (
        <p className="hint my-templates-offline">
          Couldn’t reach the server, so these are the templates saved on this device.
        </p>
      )}
      {rowError && <p className="tab-status-error">{rowError}</p>}
      {editing !== null && (
        <TemplateEditor
          // A fresh editor per template, so switching templates resets the boxes.
          key={editingTemplate?.id ?? 'new'}
          client={templatesClient}
          contest={contest}
          editing={editingTemplate}
          start={newStart}
          others={templates.filter((t) => t.id !== editingTemplate?.id)}
          questionnaireLink={questionnaireLink ?? null}
          onNeedQuestionnaireLink={() => void ensureQuestionnaireLink()}
          onCancel={() => setEditing(null)}
          onGone={(id) => setTemplates((prev) => prev.filter((p) => p.id !== id))}
          onSaved={(t) => {
            setTemplates((prev) => (prev.some((p) => p.id === t.id) ? prev.map((p) => (p.id === t.id ? t : p)) : [...prev, t]));
            setFromDevice(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  client,
  contest,
  editing,
  start,
  others,
  questionnaireLink,
  onNeedQuestionnaireLink,
  onCancel,
  onGone,
  onSaved,
}: {
  client: TemplatesClient;
  contest: Contest;
  /** The template being edited, or null for a new one. */
  editing: EmailTemplate | null;
  /** A new template's starting text (blank or a built-in starter); null when editing. */
  start: TemplateInput | null;
  /** The account's other templates (for the name and count checks). */
  others: EmailTemplate[];
  /** For the preview; null until loaded (or when it cannot be). */
  questionnaireLink: string | null;
  /** Asks for the link once the text uses {{questionnaireLink}}. */
  onNeedQuestionnaireLink: () => void;
  onCancel: () => void;
  /** The edited template no longer exists on the server (deleted on another device). */
  onGone: (id: string) => void;
  onSaved: (t: EmailTemplate) => void;
}) {
  const [name, setName] = useState(editing?.name ?? start?.name ?? '');
  const [subject, setSubject] = useState(editing?.subject ?? start?.subject ?? '');
  const [body, setBody] = useState(editing?.body ?? start?.body ?? '');
  /** What Save writes to: the edited template, or null to create a new one. */
  const [target, setTarget] = useState<EmailTemplate | null>(editing);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  /** Where "Insert field" puts the tag: the subject or body box the CM last used. */
  const lastBox = useRef<'subject' | 'body'>('body');

  function insertField(key: string) {
    const tag = mergeTag(key);
    const which = lastBox.current;
    const el = which === 'subject' ? subjectRef.current : bodyRef.current;
    const current = which === 'subject' ? subject : body;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + tag + current.slice(end);
    (which === 'subject' ? setSubject : setBody)(next);
    // Put the cursor after the inserted tag once React has updated the box.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  async function save() {
    const input = { name, subject, body };
    const problem = templateProblem(
      input,
      others.map((t) => t.name),
      others.length,
    );
    if (problem) {
      setError(templateProblemMessage(problem));
      return;
    }
    setSaving(true);
    setError(null);
    const result = target ? await client.update(target.id, input) : await client.create(input);
    setSaving(false);
    if (result.kind === 'saved') onSaved(result.template);
    else if (result.kind === 'not_found') {
      // Deleted on another device: keep the CM's text and save it as a new one next time.
      if (target) onGone(target.id);
      setTarget(null);
      setError('This template was deleted on another device. Save again to keep it as a new template.');
    }
    else if (result.kind === 'offline')
      setError('You’re offline, so the template was not saved. Try again when you’re connected.');
    else if (result.kind === 'invalid') setError(templateProblemMessage(result.problem));
    else setError('The template could not be saved. Try again.');
  }

  const preview = renderTemplate({ subject, body }, contest, { questionnaireLink });
  const needsLink = usesField({ subject, body }, QUESTIONNAIRE_LINK_FIELD);

  useEffect(() => {
    if (needsLink && questionnaireLink === null) onNeedQuestionnaireLink();
    // Ask once each time the text starts using the field; the parent dedupes.
  }, [needsLink]);

  return (
    <div className="template-editor">
      <label className="template-editor-field">
        <span>Template name</span>
        <input
          type="text"
          value={name}
          maxLength={TEMPLATE_LIMITS.name}
          placeholder="e.g. Hotel info for judges"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="template-editor-field">
        <span>Subject</span>
        <input
          ref={subjectRef}
          type="text"
          value={subject}
          maxLength={TEMPLATE_LIMITS.subject}
          onFocus={() => (lastBox.current = 'subject')}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      <label className="template-editor-field">
        <span>Body</span>
        <textarea
          ref={bodyRef}
          className="email-body"
          value={body}
          maxLength={TEMPLATE_LIMITS.body}
          onFocus={() => (lastBox.current = 'body')}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <div className="template-editor-actions">
        <select
          className="template-field-picker"
          aria-label="Insert a contest field"
          value=""
          onChange={(e) => {
            if (e.target.value) insertField(e.target.value);
          }}
        >
          <option value="">Insert a contest field…</option>
          <optgroup label="Contest details">
            {MERGE_FIELDS.filter((f) => f.kind === 'value').map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Lists and links">
            {MERGE_FIELDS.filter((f) => f.kind === 'block').map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="hint">Fields fill in from whichever contest is open when you use the template.</span>
      </div>
      {preview.unknownFields.length > 0 && (
        <p className="template-unknown-warning" role="alert">
          {preview.unknownFields.length === 1 ? 'This field isn’t recognized' : 'These fields aren’t recognized'}
          {': '}
          {preview.unknownFields.map((k) => mergeTag(k)).join(', ')}. They will appear exactly as typed. Check the
          spelling or pick from the list.
        </p>
      )}
      {(subject || body) && (
        <div className="template-preview">
          <span className="hint">Preview with this contest:</span>
          <p className="template-preview-subject">{preview.subject}</p>
          <pre className="template-preview-body">{preview.body}</pre>
        </div>
      )}
      {error && <p className="tab-status-error">{error}</p>}
      <div className="template-editor-actions">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : target ? 'Save changes' : 'Save template'}
        </button>
        <button type="button" className="btn-ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
