import { useState } from 'react';
import type { Contest } from '../model/contest';
import {
  advancingEmail,
  EMAIL_TEMPLATES,
  type EmailTemplateId,
} from '../documents/emailTemplates';
import { CopyButton } from './sections/fields';
import { Section } from './sections/Section';

/**
 * Email Draft Composer (v12 sec-email-composer). Four one-click templates and a
 * toggled advancing-schools picker fill an editable subject/body from the pure
 * emailTemplates module; the CM tweaks the text and copies it into their mail
 * client. Separate from EmailListBox (which is just the all-director address
 * list) — this composes the message itself.
 *
 * All wording lives in the pure templates; this component only holds the
 * currently-shown draft, the picker's checked set, and the resolved "To:" list.
 * The draft is local editable state (v12 let the CM edit before copying) — it is
 * intentionally NOT persisted to the contest; regenerating from a button is the
 * source of truth.
 */

/** The four one-click template buttons, in v12's row order. */
const TEMPLATE_BUTTONS: { id: EmailTemplateId; label: string }[] = [
  { id: 'announcement', label: '📢 Contest Announcement' },
  { id: 'deadline', label: '⏰ Entry Deadline Reminder' },
  { id: 'daybefore', label: '🌅 Day-Before Reminder' },
  { id: 'judges', label: '⚖️ Judge Reminder' },
  { id: 'judgeneeds', label: '🏨 Judge Needs' },
];

export function EmailComposer({ contest }: { contest: Contest }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  /** Form-order indices of the schools checked in the advancing picker. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** Resolved recipient list after generating the advancing email; null until then. */
  const [toList, setToList] = useState<string[] | null>(null);

  function loadTemplate(id: EmailTemplateId) {
    const draft = EMAIL_TEMPLATES[id](contest);
    setSubject(draft.subject);
    setBody(draft.body);
    setToList(null);
  }

  function toggleAdvancing() {
    // Reopening rebuilds the selection (v12 pattern), now PRE-SEEDED with the
    // advancing companies recorded in Results & Advancement (PRD #66, user story
    // 16): a UI-only default the CM can still adjust. Stale indices are filtered
    // to the current school list; emailTemplates stays pure and unchanged.
    setShowPicker((open) => {
      if (!open) {
        const advancing = (contest.results?.advancing ?? []).filter(
          (i) => i >= 0 && i < contest.schools.length,
        );
        setSelected(new Set(advancing));
      }
      return !open;
    });
  }

  function toggleSchool(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function generateAdvancing() {
    const indices = [...selected].sort((a, b) => a - b);
    const draft = advancingEmail(contest, indices);
    setSubject(draft.subject);
    setBody(draft.body);
    setToList(draft.to);
    setShowPicker(false);
  }

  return (
    <Section title="✉️ Email Draft Composer">
      <p className="note-box">
        Click a template to pre-fill a draft using your contest details. Edit in the boxes, then copy.
      </p>

      <div className="email-template-row">
        {TEMPLATE_BUTTONS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="email-template-btn"
            data-template={t.id}
            onClick={() => loadTemplate(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="email-template-btn email-advancing-toggle"
          onClick={toggleAdvancing}
        >
          🏆 Advancing Schools
        </button>
      </div>

      {showPicker && (
        <div className="advancing-picker">
          <p className="advancing-picker-hint">
            Select the schools that are advancing. The email will go only to their directors.
          </p>
          <div className="advancing-checks">
            {contest.schools.map((s, i) => (
              <label key={i} className="advancing-check">
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  data-idx={i}
                  onChange={() => toggleSchool(i)}
                />{' '}
                {s.name.trim() || `School ${i + 1}`}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn-primary advancing-generate-btn"
            disabled={selected.size === 0}
            onClick={generateAdvancing}
          >
            Generate Email →
          </button>
        </div>
      )}

      {toList !== null && (
        <p className="advancing-to">
          <strong>To:</strong>{' '}
          {toList.length ? (
            toList.join(', ')
          ) : (
            <em>No director emails found for the selected schools.</em>
          )}
        </p>
      )}

      <div className="email-subject-row">
        <input
          type="text"
          className="email-subject"
          placeholder="Subject will appear here…"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <CopyButton getText={() => subject} label="Copy Subject" />
      </div>

      <textarea
        className="email-body"
        placeholder="Select a template above…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <CopyButton getText={() => body} label="Copy Body" />
    </Section>
  );
}
