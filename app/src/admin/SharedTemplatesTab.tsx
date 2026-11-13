import { useEffect, useState } from 'react';
import { fetchSharedTemplates, removeSharedTemplate, type AdminSharedTemplate } from './adminClient';

/**
 * The Shared templates tab (PRD #320, slice #326): every email template CMs
 * have shared to the gallery, with its author name, owner account, share date
 * and text, and "Remove from gallery" for anything inappropriate. Removing only
 * unshares: the author keeps the template, and copies others already added are
 * untouched. Untested by convention like the rest of the panel; its server
 * routes are tested.
 */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function SharedTemplatesTab() {
  const [templates, setTemplates] = useState<AdminSharedTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setTemplates(await fetchSharedTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(t: AdminSharedTemplate) {
    if (!window.confirm(`Remove “${t.name}” from the gallery? The author keeps the template.`)) return;
    setBusy(t.id);
    setNotice(null);
    try {
      const result = await removeSharedTemplate(t.id);
      setTemplates((prev) => prev?.filter((p) => p.id !== t.id) ?? null);
      setNotice(result === 'removed' ? `Removed “${t.name}” from the gallery.` : `“${t.name}” was already unshared.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-card" aria-label="Shared templates">
      <div className="admin-feed-head">
        <h2>Shared templates</h2>
        <button type="button" className="btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {notice && <p className="muted">{notice}</p>}
      {error ? (
        <p className="muted">Shared templates unavailable.</p>
      ) : templates === null ? (
        <p className="muted">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="muted">Nothing is shared right now.</p>
      ) : (
        templates.map((t) => (
          <article key={t.id} className="admin-shared-template">
            <header className="admin-shared-template-head">
              <strong>{t.name}</strong>
              <span className="muted">
                by {t.authorName || '(no name)'} ({t.ownerEmail ?? t.ownerId}), shared {fmtDateTime(t.sharedAt)}
              </span>
            </header>
            <p className="admin-shared-template-subject">{t.subject}</p>
            <pre className="admin-shared-template-body">{t.body}</pre>
            <button type="button" className="btn-util" disabled={busy === t.id} onClick={() => void remove(t)}>
              {busy === t.id ? 'Removing…' : 'Remove from gallery'}
            </button>
          </article>
        ))
      )}
    </section>
  );
}
