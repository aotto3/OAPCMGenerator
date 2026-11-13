import { Fragment, useEffect, useState } from 'react';
import type { Contest } from '../model/contest';
import { renderTemplate } from '../templates/templateRender';
import { templateNameKey, templateProblemMessage } from '../templates/templateRules';
import type { EmailTemplate, GalleryTemplate, TemplatesClient } from '../templates/templatesClient';

/**
 * The shared-template gallery (PRD #320, slice #325): templates other CMs chose
 * to share, each with its author's name, the date shared, and its text with the
 * merge fields shown as tags (or filled from the open contest). "Add to my
 * templates" saves an independent private copy into the CM's own account; a
 * name the CM already uses asks for another name first. The CM's own shared
 * templates are marked "Yours" and cannot be added again. Online only.
 */
export function TemplateGallery({
  client,
  contest,
  mine,
  onAdded,
  onClose,
}: {
  client: TemplatesClient;
  contest: Contest;
  /** The CM's own templates, for the name-clash check. */
  mine: EmailTemplate[];
  onAdded: (t: EmailTemplate) => void;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<GalleryTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [filled, setFilled] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    const result = await client.gallery();
    if (result.kind === 'ok') setCards(result.templates);
    else
      setLoadError(
        result.kind === 'offline'
          ? 'You’re offline. Shared templates need a connection.'
          : 'Shared templates could not be loaded. Try again.',
      );
  }

  useEffect(() => {
    void load();
  }, [client]);

  /** A name not yet used in the CM's account, for the rename prompt's default. */
  function freeName(base: string): string {
    const taken = new Set(mine.map((t) => templateNameKey(t.name)));
    let name = base;
    for (let n = 2; taken.has(templateNameKey(name)); n++) name = `${base} (${n})`;
    return name;
  }

  async function add(card: GalleryTemplate) {
    let name: string | undefined;
    if (mine.some((t) => templateNameKey(t.name) === templateNameKey(card.name))) {
      const answer = window.prompt(
        `You already have a template named “${card.name}”. Name your copy:`,
        freeName(card.name),
      );
      if (answer === null) return;
      name = answer;
    }
    setBusy(card.id);
    setStatus(null);
    const result = await client.addFromGallery(card.id, name);
    setBusy(null);
    if (result.kind === 'saved') {
      onAdded(result.template);
      setStatus({ id: card.id, ok: true, text: `Added “${result.template.name}” to your templates.` });
    } else if (result.kind === 'not_found') {
      setStatus({ id: card.id, ok: false, text: 'That template is no longer shared.' });
      void load();
    } else if (result.kind === 'invalid') {
      setStatus({ id: card.id, ok: false, text: templateProblemMessage(result.problem) });
    } else if (result.kind === 'offline') {
      setStatus({ id: card.id, ok: false, text: 'You’re offline, so the template was not added.' });
    } else {
      setStatus({ id: card.id, ok: false, text: 'The template could not be added. Try again.' });
    }
  }

  function toggleFilled(id: string) {
    setFilled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="template-gallery">
      <div className="template-gallery-head">
        <strong>Shared by other contest managers</strong>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {loadError && <p className="tab-status-error">{loadError}</p>}
      {cards === null && !loadError && <p className="hint">Loading…</p>}
      {cards !== null && cards.length === 0 && <p className="hint">No one has shared a template yet.</p>}
      {cards?.map((card) => {
        const showFilled = filled.has(card.id);
        const text = showFilled ? renderTemplate(card, contest) : card;
        return (
          <article key={card.id} className="template-card">
            <header className="template-card-head">
              <strong>{card.name}</strong>
              {card.mine && <span className="template-badge">Yours</span>}
              <span className="hint">
                by {card.authorName || 'a contest manager'} · shared {sharedDate(card.sharedAt)}
              </span>
            </header>
            <p className="template-preview-subject">{showFilled ? text.subject : <Tagged text={card.subject} />}</p>
            <pre className="template-preview-body">{showFilled ? text.body : <Tagged text={card.body} />}</pre>
            <div className="template-editor-actions">
              {!card.mine && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy === card.id}
                  onClick={() => void add(card)}
                >
                  {busy === card.id ? 'Adding…' : 'Add to my templates'}
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => toggleFilled(card.id)}>
                {showFilled ? 'Show the fields' : 'Preview with this contest'}
              </button>
            </div>
            {status?.id === card.id && <p className={status.ok ? 'hint' : 'tab-status-error'}>{status.text}</p>}
          </article>
        );
      })}
    </div>
  );
}

/** Text with each {{field}} shown as a tag. */
function Tagged({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[A-Za-z0-9_]+\s*\}\})/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="template-tag">
            {part.replace(/[{}\s]/g, '')}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** "Nov 13, 2026" from an ISO instant; '' when unreadable. */
function sharedDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
