import { useState } from 'react';
import type { Contest } from '../model/contest';
import { saveContest } from '../storage/contestStore';
import { signOut, useSession } from '../auth/authClient';
import { SignIn } from '../auth/SignIn';
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
 * Auth gate (PRD user stories 1, 2). Contests are still stored locally in this
 * slice; wiring them to the per-account server API is the next slice (#27,
 * background sync). Here we only require a signed-in session to reach the app
 * and expose sign-out — proving the deployed sign-in flow end to end.
 */
export function App() {
  const { data: session, isPending } = useSession();

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
        <span className="muted">{session.user.email}</span>
        <button className="btn-ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      <ContestFlow />
    </>
  );
}
