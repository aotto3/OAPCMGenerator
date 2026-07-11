import { useEffect, useState } from 'react';
import {
  contestDisplayName,
  sectionCompletion,
  validateContest,
  type Contest,
} from '../model/contest';
import { getContest } from '../storage/contestStore';
import { useAutosave } from '../storage/useAutosave';
import { SectionOpenContext, type SectionOpenSignal } from './sections/Section';
import { ReadinessPage } from './ReadinessPage';
import { ReadinessSummary } from './ReadinessSummary';
import { WorkspacePane } from './WorkspacePane';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import {
  canonicalPane,
  landingPane,
  paneModules,
  type ModuleId,
  type PaneId,
} from './paneRegistry';

/**
 * Contest workspace — the v12 data-entry sections, now grouped into content-swapped
 * panes driven by the sidebar (PRD #127). Pattern to keep: state lives in one
 * `Contest` value, every change goes through the model's update helpers (sections
 * receive the contest and hand back the next one), and useAutosave persists it —
 * components never talk to IndexedDB directly. The current pane is ordinary
 * component state (router-ready, but no URL routing in v1); switching panes only
 * unmounts/mounts modules, so autosave keeps unsaved work safe across a switch.
 */
export function Workspace({
  contestId,
  draft,
  onBack,
  onOpenSaved,
}: {
  contestId: string;
  /** Fresh unsaved contest from "+ New Contest" — not in storage yet. */
  draft?: Contest;
  onBack: () => void;
  /** Persist a brand-new contest (e.g. the advance-clone) and open it. */
  onOpenSaved: (contest: Contest) => void | Promise<void>;
}) {
  const [contest, setContest] = useState<Contest>();
  const [missing, setMissing] = useState(false);
  // Global expand/collapse-all signal broadcast to every mounted Section via
  // context. Content-swap makes this per-pane for free: only the current pane's
  // sections are mounted, so a broadcast reaches just them.
  const [openSignal, setOpenSignal] = useState<SectionOpenSignal | null>(null);
  const setAllSections = (open: boolean) =>
    setOpenSignal((s) => ({ open, nonce: (s?.nonce ?? 0) + 1 }));
  // The current destination: the Readiness hub or one of the panes. A fresh draft
  // lands on Setup (start typing); a saved contest lands on Readiness (status).
  const isDraft = !!(draft && draft.id === contestId);
  const [view, setView] = useState<PaneId>(() => landingPane(isDraft));
  // Mobile: the off-canvas sidebar drawer's open state (the desktop rail ignores it).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A module anchor to scroll to once its pane's content mounts — set when a
  // readiness item's jump fires (switch to the canonical pane, then scroll).
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  useEffect(() => {
    if (draft && draft.id === contestId) {
      setContest(draft);
      return;
    }
    void getContest(contestId).then((c) => (c ? setContest(c) : setMissing(true)));
  }, [contestId, draft]);

  useAutosave(contest);

  // After a jump, wait for the target pane's anchors to mount, then smooth-scroll
  // to the module. Skipped on the Readiness hub (no module anchors there). A
  // double rAF is deliberate: content-swap mounts the pane fresh, so the first
  // frame paints it and the second lets layout settle before we read the anchor's
  // final position — a single frame scrolls to a stale (too-short-page) offset.
  useEffect(() => {
    if (view === 'readiness' || !pendingScroll) return;
    const id = pendingScroll;
    setPendingScroll(null);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      ),
    );
  }, [view, pendingScroll]);

  if (missing) {
    return (
      <main className="page">
        <p>Contest not found.</p>
        <button className="btn-ghost" onClick={onBack}>← Back to dashboard</button>
      </main>
    );
  }
  if (!contest) return <main className="page"><p className="muted">Loading…</p></main>;

  /** Navigate to a pane from the sidebar (a plain switch, no pending scroll). */
  const selectPane = (pane: PaneId) => {
    setPendingScroll(null);
    setView(pane);
  };

  /** Readiness jump: open a module's canonical pane, then scroll to its anchor. */
  const jumpToSection = (sectionId: string) => {
    const module = sectionId.replace(/^sec-/, '') as ModuleId;
    setPendingScroll(sectionId);
    setView(canonicalPane(module));
  };

  const progress = sectionCompletion(contest);
  const issues = validateContest(contest);
  // Expand/Collapse-all is only meaningful where a pane stacks several collapsible
  // modules — kept for the heavy panes (Schools), hidden on single-module ones.
  const showToggleAll =
    view !== 'readiness' && paneModules(view).filter((m) => !m.mirror).length > 1;

  return (
    <SectionOpenContext.Provider value={openSignal}>
      <div className="workspace">
        <header className="page-header workspace-header">
          <div className="workspace-header-top">
            <button
              type="button"
              className="ws-hamburger"
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
            >
              ☰
            </button>
            <button className="btn-ghost" onClick={onBack}>← All contests</button>
          </div>
          <h1>{contestDisplayName(contest.identity)}</h1>
          <p className="subtitle">Every change saves automatically.</p>
        </header>

        <div className="workspace-shell">
          <WorkspaceSidebar
            current={view}
            onSelect={selectPane}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
          />

          <main className="workspace-main">
            {view === 'readiness' ? (
              <ReadinessPage contest={contest} onChange={setContest} onJump={jumpToSection} />
            ) : (
              <>
                <ReadinessSummary contest={contest} onOpen={() => setView('readiness')} />

                {issues.length > 0 && (
                  <ul className="issues">
                    {issues.map((issue) => (
                      <li key={issue.field}>⚠️ {issue.message}</li>
                    ))}
                  </ul>
                )}

                {showToggleAll && (
                  <div className="pane-toolbar">
                    <div className="ws-toggle-all">
                      <button type="button" onClick={() => setAllSections(true)}>Expand all</button>
                      <span className="sep" aria-hidden>·</span>
                      <button type="button" onClick={() => setAllSections(false)}>Collapse all</button>
                    </div>
                  </div>
                )}

                <WorkspacePane
                  pane={view}
                  contest={contest}
                  progress={progress}
                  onChange={setContest}
                  onOpenSaved={onOpenSaved}
                />
              </>
            )}
          </main>
        </div>
      </div>
    </SectionOpenContext.Provider>
  );
}
