import { useState } from 'react';
import type { Contest } from '../model/contest';
import { Dashboard } from './Dashboard';
import { Workspace } from './Workspace';

/**
 * Dashboard-first flow: contest list → contest workspace → back.
 * Navigation is a single piece of state for now; a router can replace it
 * in a later slice without touching Dashboard/Workspace internals.
 *
 * "+ New Contest" opens an in-memory draft (`draft` below) — nothing is
 * written to storage until the user actually edits a field, so an
 * accidental click leaves no stray contest behind.
 */
export function App() {
  const [open, setOpen] = useState<{ id: string; draft?: Contest } | null>(null);

  return open === null ? (
    <Dashboard
      onOpen={(id) => setOpen({ id })}
      onCreate={(draft) => setOpen({ id: draft.id, draft })}
    />
  ) : (
    <Workspace contestId={open.id} draft={open.draft} onBack={() => setOpen(null)} />
  );
}
