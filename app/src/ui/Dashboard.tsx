import { useEffect, useRef, useState } from 'react';
import { createContest, duplicateContest, importContest } from '../model/contest';
import type { Contest } from '../model/contest';
import {
  deleteContest,
  getContest,
  listContests,
  onContestPulled,
  type ContestSummary,
} from '../storage/contestStore';

function lastEdited(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? '' : `last edited ${date.toLocaleString()}`;
}

export function Dashboard({
  onOpen,
  onCreate,
  onOpenSaved,
}: {
  onOpen: (id: string) => void;
  onCreate: (draft: Contest) => void;
  /** Persist a fully-formed new contest (import/duplicate), then open it. */
  onOpenSaved: (contest: Contest) => void | Promise<void>;
}) {
  const [contests, setContests] = useState<ContestSummary[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => void listContests().then((list) => active && setContests(list));
    refresh();
    // Background sync pulls land in IndexedDB without re-rendering us; refresh
    // the list when one arrives so a pull while the dashboard is open shows up
    // without a manual reload (Slice 14 gap, closed in Slice 15 / #28).
    const off = onContestPulled(refresh);
    return () => {
      active = false;
      off();
    };
  }, []);

  // Opens an in-memory draft; nothing is stored until the first edit.
  function handleCreate() {
    onCreate(createContest());
  }

  // Import a contest file (the JSON bundled in every generated ZIP) as a NEW
  // contest. The model parses + migrates + rejects bad input; we only read the
  // file and surface a friendly error. Reset the input so re-picking the same
  // file fires onChange again.
  async function handleImportFile(file: File) {
    setImportError(null);
    try {
      const contest = importContest(await file.text());
      await onOpenSaved(contest);
    } catch (err) {
      setImportError(
        `Couldn't import "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function handleDuplicate(summary: ContestSummary) {
    const source = await getContest(summary.id);
    if (!source) return; // deleted out from under us
    await onOpenSaved(duplicateContest(source));
  }

  async function handleDelete(summary: ContestSummary) {
    if (!window.confirm(`Delete "${summary.name}"? This cannot be undone.`)) return;
    await deleteContest(summary.id);
    setContests(await listContests());
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>🎭 OAP Contest Manager</h1>
        <p className="subtitle">UIL One-Act Play contest documents — 2.0</p>
      </header>

      <div className="toolbar">
        <h2>Your Contests</h2>
        <div className="toolbar-actions">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleImportFile(file);
            }}
          />
          <button className="btn-secondary" onClick={() => fileInput.current?.click()}>
            Import contest file
          </button>
          <button className="btn-primary" onClick={handleCreate}>
            + New Contest
          </button>
        </div>
      </div>

      {importError && (
        <p className="import-error" role="alert">
          ⚠️ {importError}
        </p>
      )}

      {contests === null ? (
        <p className="muted">Loading…</p>
      ) : contests.length === 0 ? (
        <p className="muted">No contests yet. Create one to get started.</p>
      ) : (
        <ul className="contest-list">
          {contests.map((c) => (
            <li key={c.id} className="contest-row">
              <button className="contest-open" onClick={() => onOpen(c.id)}>
                <span className="contest-name">{c.name}</span>
                <span className="muted"> · {lastEdited(c.updatedAt)}</span>
              </button>
              <button
                className="btn-secondary"
                onClick={() => void handleDuplicate(c)}
                aria-label={`Duplicate ${c.name}`}
              >
                Duplicate
              </button>
              <button
                className="btn-danger"
                onClick={() => void handleDelete(c)}
                aria-label={`Delete ${c.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
