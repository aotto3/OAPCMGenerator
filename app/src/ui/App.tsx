import { useState } from 'react';
import type { Contest } from '../model/contest';
import { saveContest } from '../storage/contestStore';
import { signOut, useSession } from '../auth/authClient';
import { SignIn } from '../auth/SignIn';
import { Dashboard } from './Dashboard';
import { SyncStatus } from './SyncStatus';
import { useSync } from './useSync';
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
function ContestFlow() {
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

/**
 * Auth gate (PRD user stories 1, 2). Once signed in, background sync (Slice 14,
 * issue #27) keeps this device's contests in step with the account: useSync
 * starts the engine and the SyncStatus indicator reflects it. Contests still
 * live locally in IndexedDB and edits never block on the network — sync runs in
 * the storage layer, off the typing path.
 */
export function App() {
  const { data: session, isPending } = useSession();
  const syncStatus = useSync(!!session);

  if (isPending) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!session) return <SignIn />;

  return (
    <>
      <div className="account-bar">
        <SyncStatus status={syncStatus} />
        <span className="muted">{session.user.email}</span>
        <button className="btn-ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      <ContestFlow />
    </>
  );
}
