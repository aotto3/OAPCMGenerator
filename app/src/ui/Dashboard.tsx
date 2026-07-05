import { useEffect, useState } from 'react';
import { createContest } from '../model/contest';
import type { Contest } from '../model/contest';
import { deleteContest, listContests, type ContestSummary } from '../storage/contestStore';

function lastEdited(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? '' : `last edited ${date.toLocaleString()}`;
}

export function Dashboard({
  onOpen,
  onCreate,
}: {
  onOpen: (id: string) => void;
  onCreate: (draft: Contest) => void;
}) {
  const [contests, setContests] = useState<ContestSummary[] | null>(null);

  useEffect(() => {
    void listContests().then(setContests);
  }, []);

  // Opens an in-memory draft; nothing is stored until the first edit.
  function handleCreate() {
    onCreate(createContest());
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
        <button className="btn-primary" onClick={handleCreate}>
          + New Contest
        </button>
      </div>

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
