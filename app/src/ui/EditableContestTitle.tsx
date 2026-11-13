import { useState } from 'react';

/**
 * The workspace-header contest title as a click-to-edit control (PRD #143).
 * Shows the effective title as an <h1> with a pencil affordance; clicking swaps
 * to a text input holding the title as shown, so a small change is a small edit
 * (placeholder = the auto name). Enter / blur commits; Escape cancels.
 * Committing an empty value, or the auto name itself, clears the override so the
 * title follows the contest details again.
 */
export function EditableContestTitle({
  title,
  override,
  autoName,
  onChange,
}: {
  /** The effective title to display when not editing (custom or auto). */
  title: string;
  /** Current custom override ('' when using the auto name). */
  override: string;
  /** The auto-derived name, shown as the input placeholder. */
  autoName: string;
  /** Commit a new override; '' reverts to the auto name. */
  onChange: (override: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  function start() {
    setDraft(title);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const typed = draft.trim();
    const next = typed === autoName.trim() ? '' : typed;
    if (next !== override) onChange(next);
  }

  if (editing) {
    return (
      <h1 className="ws-title ws-title-editing">
        <input
          className="ws-title-input"
          value={draft}
          placeholder={autoName}
          aria-label="Contest title"
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur(); // triggers commit
            } else if (e.key === 'Escape') {
              setEditing(false); // discard the draft
            }
          }}
        />
      </h1>
    );
  }

  return (
    <h1 className="ws-title">
      <span>{title}</span>
      <button type="button" className="ws-title-edit" aria-label="Rename contest" onClick={start}>
        ✏️
      </button>
    </h1>
  );
}
