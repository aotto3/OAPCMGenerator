import { useEffect, useState } from 'react';
import type { Contest } from '../model/contest';
import { contestLibrary } from '../storage/browserLibrary';
import { requestPersistentStorage } from '../storage/persist';
import { AdminPanel } from '../admin/AdminPanel';
import { useIsAdmin } from '../admin/useIsAdmin';
import { signOut, useSession } from '../auth/authClient';
import { SignIn } from '../auth/SignIn';
import { useContestSync } from './contestHooks';
import { formatRoute, parseRoute, type ContestRoute } from './contestRoute';
import { Dashboard } from './Dashboard';
import { SyncStatus } from './SyncStatus';
import { ThemeToggle } from './ThemeToggle';
import { UpdatePrompt } from './UpdatePrompt';
import { Workspace } from './Workspace';
import { QuestionnairePage } from '../questionnaire/QuestionnairePage';
import { questionnaireTokenFromPath } from '../questionnaire/questionnaireClient';

/**
 * Dashboard-first flow: contest list → contest workspace → back.
 * Navigation is the URL (see contestRoute.ts), driven with pushState and
 * popstate rather than a router library.
 *
 * "+ New Contest" opens an in-memory draft (`draft` below) — nothing is
 * written to storage until the user actually edits a field, so an
 * accidental click leaves no stray contest behind. Import, Duplicate and
 * Start next year, by
 * contrast, produce a fully-formed contest that is persisted immediately
 * (openSaved) before opening — there is nothing to "edit first".
 */
function ContestFlow() {
  // The address bar is the navigation state (PRD #304, #305): which contest and
  // pane are open lives in the URL, so a refresh keeps the CM's place and the
  // browser's Back/Forward step through it. `route` mirrors location.pathname.
  const [route, setRoute] = useState<ContestRoute>(() => parseRoute(window.location.pathname));
  // The one in-memory draft from "+ New Contest" (not in storage until edited),
  // plus whether its CM info was carried from an earlier contest (#307).
  const [draft, setDraft] = useState<{ contest: Contest; cmCarried: boolean } | null>(null);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Go to a route: push a history entry (or replace the current one). */
  function navigate(next: ContestRoute, opts: { replace?: boolean } = {}) {
    const path = formatRoute(next);
    if (path !== window.location.pathname) {
      if (opts.replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
    }
    setRoute(next);
  }

  const openContest = (id: string) => navigate({ kind: 'contest', id });

  async function openSaved(contest: Contest) {
    await contestLibrary().add(contest);
    openContest(contest.id);
  }

  if (route.kind === 'dashboard') {
    return (
      <Dashboard
        onOpen={openContest}
        onCreate={(contest, cmCarried) => {
          setDraft({ contest, cmCarried });
          openContest(contest.id);
        }}
        onOpenSaved={openSaved}
      />
    );
  }

  const isDraft = draft?.contest.id === route.id;
  return (
    // Keyed so opening another contest remounts it: autosave flushes the old
    // contest's pending edits, and pane state starts fresh for the new one.
    <Workspace
      key={route.id}
      contestId={route.id}
      draft={isDraft ? draft.contest : undefined}
      cmCarried={isDraft && draft.cmCarried}
      pane={route.pane}
      onPane={(pane, opts) => navigate({ kind: 'contest', id: route.id, pane }, opts)}
      onBack={() => navigate({ kind: 'dashboard' })}
      onOpenSaved={openSaved}
      onOpenContest={openContest}
    />
  );
}

/**
 * Auth gate (PRD user stories 1, 2). Once signed in, background sync (Slice 14,
 * issue #27) keeps this device's contests in step with the account: useContestSync
 * starts the library's sync and the SyncStatus indicator reflects it. Contests still
 * live locally in IndexedDB and edits never block on the network — sync runs in
 * the storage layer, off the typing path.
 */
export function App() {
  // The public judge questionnaire (/q/<token>, PRD #252) needs no sign-in and
  // none of the account app, so it branches off before the auth gate. The path
  // never changes within a page load, so this is a stable branch.
  const questionnaireToken = questionnaireTokenFromPath(window.location.pathname);
  if (questionnaireToken) {
    return (
      <>
        <QuestionnairePage token={questionnaireToken} />
        <AppFooter />
      </>
    );
  }
  return <AccountApp />;
}

function AppFooter() {
  return (
    <footer className="app-footer">
      <span>© 2026 Allen Otto · OAP Contest Manager</span>
      <span aria-hidden="true" className="app-footer-sep">·</span>
      <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms</a>
      <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy</a>
    </footer>
  );
}

function AccountApp() {
  const { data: session, isPending } = useSession();
  const syncStatus = useContestSync(!!session);
  // Admin gate: probe the server once signed in. Non-admins get a 404 → false,
  // so nothing below ever renders for them (PRD user story 13). The server
  // re-checks admin on every request behind the panel regardless.
  const isAdmin = useIsAdmin(!!session);
  const [showAdmin, setShowAdmin] = useState(false);

  // Ask the browser to make this origin's IndexedDB persistent once the user is
  // signed in and actually has contests to protect (Slice 15, #28). Best-effort
  // and fire-and-forget: the app works whether or not it's granted.
  useEffect(() => {
    if (session) void requestPersistentStorage();
  }, [!!session]);

  // The auth-gated content. Computed as one node so UpdatePrompt can render at a
  // stable position after it in every state — otherwise the loading → sign-in →
  // app transitions would remount UpdatePrompt and needlessly re-register the SW.
  const content = isPending ? (
    <div className="page">
      <p className="muted">Loading…</p>
    </div>
  ) : !session ? (
    <SignIn />
  ) : (
    <>
      <div className="account-bar">
        <SyncStatus status={syncStatus} />
        <ThemeToggle />
        <span className="muted">{session.user.email}</span>
        {isAdmin && (
          <button className="btn-ghost" onClick={() => setShowAdmin((v) => !v)}>
            {showAdmin ? 'Contests' : 'Admin'}
          </button>
        )}
        <button className="btn-ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      {isAdmin && showAdmin ? <AdminPanel onBack={() => setShowAdmin(false)} /> : <ContestFlow />}
    </>
  );

  return (
    <>
      {content}
      {/* Ownership/attribution notice — shown in every state (loading, sign-in,
          app). Links to the hosted Terms and Privacy pages (app/public/). */}
      <AppFooter />
      {/* Registers the service worker (once, stable across auth state) and
          surfaces new deploys via a subtle update banner. */}
      <UpdatePrompt />
    </>
  );
}
