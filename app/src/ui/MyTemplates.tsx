import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../auth/authClient';
import type { Contest } from '../model/contest';
import { MERGE_FIELDS, mergeTag, renderTemplate } from '../templates/templateRender';
import { TEMPLATE_LIMITS, templateProblem, templateProblemMessage } from '../templates/templateRules';
import { createTemplatesClient, type EmailTemplate, type TemplatesClient } from '../templates/templatesClient';

/**
 * The CM's own email templates in the Email Draft Composer (PRD #320): a "My
 * templates" button row under the built-ins and a "+ New template" editor.
 *
 * Templates belong to the account, not the contest, so the same row appears in
 * every contest. Clicking one fills the composer's subject and body from the
 * open contest (renderTemplate) and leaves the To: line empty; the CM adds
 * recipients. The list shows the device copy at once, then the server's answer;
 * saving needs a connection.
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
  const [editing, setEditing] = useState(false);

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

  if (!client) return null;

  function load(t: EmailTemplate) {
    const filled = renderTemplate(t, contest);
    onLoad({ subject: filled.subject, body: filled.body });
  }

  return (
    <div className="my-templates">
      <div className="my-templates-head">
        <strong>My templates</strong>
        <span className="hint">Yours in every contest. Recipients are left for you to add.</span>
      </div>
      <div className="email-template-row">
        {templates.map((t) => (
          <button key={t.id} type="button" className="email-template-btn my-template-btn" onClick={() => load(t)}>
            {t.name}
          </button>
        ))}
        {!editing && (
          <button type="button" className="btn-util" onClick={() => setEditing(true)}>
            + New template
          </button>
        )}
      </div>
      {fromDevice && (
        <p className="hint my-templates-offline">
          Couldn’t reach the server, so these are the templates saved on this device.
        </p>
      )}
      {editing && (
        <TemplateEditor
          client={client}
          contest={contest}
          others={templates}
          onCancel={() => setEditing(false)}
          onSaved={(t) => {
            setTemplates((prev) => [...prev.filter((p) => p.id !== t.id), t]);
            setFromDevice(false);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  client,
  contest,
  others,
  onCancel,
  onSaved,
}: {
  client: TemplatesClient;
  contest: Contest;
  /** The account's other templates (for the name and count checks). */
  others: EmailTemplate[];
  onCancel: () => void;
  onSaved: (t: EmailTemplate) => void;
}) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
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
    const result = await client.create(input);
    setSaving(false);
    if (result.kind === 'saved') onSaved(result.template);
    else if (result.kind === 'offline')
      setError('You’re offline, so the template was not saved. Try again when you’re connected.');
    else if (result.kind === 'invalid') setError(templateProblemMessage(result.problem));
    else setError('The template could not be saved. Try again.');
  }

  const preview = renderTemplate({ subject, body }, contest);

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
          {MERGE_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="hint">Fields fill in from whichever contest is open when you use the template.</span>
      </div>
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
          {saving ? 'Saving…' : 'Save template'}
        </button>
        <button type="button" className="btn-ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
