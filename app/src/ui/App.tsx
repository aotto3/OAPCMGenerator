import { useState } from 'react';
import type { Contest } from '../model/contest';
import { saveContest } from '../storage/contestStore';
import { Dashboard } from './Dashboard';
import { Workspace } from './Workspace';

/**
 * Dashboard-first flow: contest list → contest workspace → back.
 * Navigation is a single piece of state for now; a router can replace it
 * in a later slice without touching Dashboard/Workspace internals.
 *
 * "+ New Contest" opens an in-memory draft (`draft` below) — nothing is
 * written to storage until the user actually edits a field, so an
 * accidental click leaves no stray contest behind. Import and Duplicate, by
 * contrast, produce a fully-formed contest that is persisted immediately
 * (openSaved) before opening — there is nothing to "edit first".
 */
export function App() {
  const [open, setOpen] = useState<{ id: string; draft?: Contest } | null>(null);

  async function openSaved(contest: Contest) {
    await saveContest(contest);
    setOpen({ id: contest.id });
  }

  return open === null ? (
    <Dashboard
      onOpen={(id) => setOpen({ id })}
      onCreate={(draft) => setOpen({ id: draft.id, draft })}
      onOpenSaved={openSaved}
    />
  ) : (
    <Workspace contestId={open.id} draft={open.draft} onBack={() => setOpen(null)} />
  );
}
