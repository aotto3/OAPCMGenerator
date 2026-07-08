import { useEffect, useState } from 'react';
import type { Contest } from '../../model/contest';
import type { Checkpoint } from '../../model/checkpoint';
import {
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  updateCheckpointNote,
} from '../../storage/checkpointStore';
import { relativeTime } from '../relativeTime';
import { Section } from './Section';

/**
 * Version History (PRD user stories 10 & 11) — the 2.0 replacement for v12's
 * browser "snapshots" panel. Save a named checkpoint with an optional note, see
 * the per-contest history with relative times, and restore one (after a confirm)
 * to roll back. Restore is undoable: restoreCheckpoint auto-checkpoints the
 * current state first, so the pre-restore working copy is always recoverable.
 *
 * This is the one workspace panel that owns async storage state (the checkpoint
 * list): the model checkpoints are separate records, not part of the contest, so
 * they don't ride the contest autosave. Everything else still flows through the
 * contest value — onRestore hands the restored contest back up to the workspace.
 */
export function HistorySection({
  contest,
  onRestore,
}: {
  contest: Contest;
  onRestore: (next: Contest) => void;
}) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const contestId = contest.id;

  async function reload() {
    setCheckpoints(await listCheckpoints(contestId));
  }

  // Reload only when switching contests; checkpoint edits reload explicitly.
  useEffect(() => {
    void reload();
  }, [contestId]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the checkpoint a name before saving.');
      return;
    }
    setError(null);
    await createCheckpoint(contest, trimmed, note);
    setName('');
    setNote('');
    await reload();
  }

  async function handleRestore(checkpoint: Checkpoint) {
    if (
      !window.confirm(
        `Restore "${checkpoint.name}"? This replaces your current working copy. ` +
          'Your current state is saved as an automatic checkpoint first, so you can undo this.',
      )
    ) {
      return;
    }
    const restored = await restoreCheckpoint(contest, checkpoint.id);
    onRestore(restored);
    await reload();
  }

  async function handleEditNote(checkpoint: Checkpoint) {
    const next = window.prompt(`Note for "${checkpoint.name}":\n(Leave blank to clear)`, checkpoint.note);
    if (next === null) return; // cancelled
    await updateCheckpointNote(checkpoint.id, next);
    await reload();
  }

  async function handleDelete(checkpoint: Checkpoint) {
    if (!window.confirm(`Delete checkpoint "${checkpoint.name}"?`)) return;
    await deleteCheckpoint(checkpoint.id);
    await reload();
  }

  return (
    <Section title="💾 Manual Save" defaultOpen={false}>
      <div className="note-box">
        Save a named checkpoint to capture the contest at an important moment (e.g. “before judge change”).
        Restoring a checkpoint replaces your current data — but first saves the current state as an automatic
        checkpoint, so a restore can always be undone.
      </div>

      <div className="checkpoint-save">
        <input
          className="checkpoint-name-input"
          type="text"
          placeholder="Checkpoint name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="checkpoint-note-input"
          type="text"
          placeholder="Optional note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={() => void handleSave()}>
          💾 Save Checkpoint
        </button>
      </div>
      {error && <p className="checkpoint-error" role="alert">⚠️ {error}</p>}

      {checkpoints.length === 0 ? (
        <p className="muted checkpoint-empty">No checkpoints yet. Save one to capture this moment.</p>
      ) : (
        <ul className="checkpoint-list">
          {checkpoints.map((c) => (
            <li key={c.id} className="checkpoint-row">
              <div className="checkpoint-info">
                <div className="checkpoint-name">{c.name}</div>
                <div className="checkpoint-meta">{relativeTime(c.createdAt)}</div>
                {c.note && <div className="checkpoint-note">📝 {c.note}</div>}
              </div>
              <div className="checkpoint-actions">
                <button type="button" className="btn-util" onClick={() => void handleRestore(c)}>
                  📂 Restore
                </button>
                <button
                  type="button"
                  className="btn-util"
                  title="Edit note"
                  onClick={() => void handleEditNote(c)}
                >
                  📝
                </button>
                <button type="button" className="btn-danger" onClick={() => void handleDelete(c)}>
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
