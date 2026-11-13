import { useEffect, useRef, useState } from 'react';
import {
  contestDisplayName,
  effectiveContestTitle,
  sectionCompletion,
  validateContest,
  withArchived,
  withTitleOverride,
  type Contest,
} from '../model/contest';
import { EditableContestTitle } from './EditableContestTitle';
import { useAwaitFirstPass, useContestList, useOpenContest } from './contestHooks';
import { clearArchiveOffer, pendingArchiveOffer } from './archiveOffer';
import { contestLibrary } from '../storage/browserLibrary';
import { SectionOpenContext, type SectionOpenSignal } from './sections/Section';
import { ReadinessPage } from './ReadinessPage';
import { ReadinessSummary } from './ReadinessSummary';
import { UndoToast } from './UndoToast';
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
 * receive the contest and hand back the next one), and the open-contest session
 * (useOpenContest) persists it; components never talk to IndexedDB directly. A
 * newer copy from another device swaps in through the session with a notice. The current pane comes
 * from the URL (#305; App owns history); switching panes only
 * unmounts/mounts modules, so autosave keeps unsaved work safe across a switch.
 */
export function Workspace({
  contestId,
  draft,
  cmCarried = false,
  pane,
  onPane,
  onDraftSaved,
  onBack,
  onOpenSaved,
  onOpenContest,
}: {
  contestId: string;
  /** Fresh unsaved contest from "+ New Contest" — not in storage yet. */
  draft?: Contest;
  /** The draft's CM info was carried from an earlier contest (#307): show the note. */
  cmCarried?: boolean;
  /** The pane named in the URL; absent ⇒ the landing rule picks one (#305). */
  pane?: PaneId;
  /** Navigate to a pane: pushes a history entry, or replaces it with `replace`. */
  onPane: (pane: PaneId, opts?: { replace?: boolean }) => void;
  /** A draft's first edit just saved it (#310): the URL can switch to its real address. */
  onDraftSaved?: (pane: PaneId) => void;
  onBack: () => void;
  /** Persist a brand-new contest (e.g. the advance-clone) and open it. */
  onOpenSaved: (contest: Contest) => void | Promise<void>;
  /** Open another saved contest (e.g. the other zone). */
  onOpenContest: (id: string) => void;
}) {
  const isDraft = !!(draft && draft.id === contestId);
  // Bumped to reopen the contest after the first sync pass, in case it was
  // pulled onto this device just now (#310).
  const [attempt, setAttempt] = useState(0);
  const open = useOpenContest(contestId, isDraft ? draft : undefined, attempt);
  const presence = useAwaitFirstPass(open.status === 'missing', () => setAttempt((a) => a + 1));
  // A draft is stored by its first edit; report that once so the URL can follow.
  const draftSaved = useRef(!isDraft);
  // The one-time "Archive the contest you started from?" offer (#311).
  const [archiveOfferFrom, setArchiveOfferFrom] = useState(() => pendingArchiveOffer(contestId));
  const summaries = useContestList();
  // A source that is gone or already archived needs no offer: drop it for good.
  useEffect(() => {
    if (!archiveOfferFrom || !summaries) return;
    const source = summaries.find((c) => c.id === archiveOfferFrom);
    if (!source || source.archived) {
      clearArchiveOffer(contestId);
      setArchiveOfferFrom(null);
    }
  }, [archiveOfferFrom, summaries, contestId]);
  // Global expand/collapse-all signal broadcast to every mounted Section via
  // context. Content-swap makes this per-pane for free: only the current pane's
  // sections are mounted, so a broadcast reaches just them.
  const [openSignal, setOpenSignal] = useState<SectionOpenSignal | null>(null);
  const setAllSections = (open: boolean) =>
    setOpenSignal((s) => ({ open, nonce: (s?.nonce ?? 0) + 1 }));
  // The current destination lives in the URL (#305). With no pane named, a fresh
  // draft lands on Setup (start typing) and a saved contest on Readiness (status),
  // and the landing pane is written back into the URL without a history step.
  const [landing] = useState<PaneId>(() => landingPane(isDraft));
  const view: PaneId = pane ?? landing;
  useEffect(() => {
    if (!pane) onPane(landing, { replace: true });
  }, [pane, landing, onPane]);
  const setView = (next: PaneId) => onPane(next);
  // The "Filled from your last contest" note (#307), dismissible for this session.
  const [cmNoteDismissed, setCmNoteDismissed] = useState(false);
  // Mobile: the off-canvas sidebar drawer's open state (the desktop rail ignores it).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A module anchor to scroll to once its pane's content mounts — set when a
  // readiness item's jump fires (switch to the canonical pane, then scroll).
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

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

  if (open.status === 'missing' && presence === 'waiting') {
    return (
      <main className="page">
        <p className="muted">Looking for this contest… (waiting for your contests to sync)</p>
        <button className="btn-ghost" onClick={onBack}>← Back to dashboard</button>
      </main>
    );
  }
  if (open.status === 'missing') {
    return (
      <main className="page">
        <p>Contest not found.</p>
        <button className="btn-ghost" onClick={onBack}>← Back to dashboard</button>
      </main>
    );
  }
  if (open.status === 'removed') {
    return (
      <main className="page">
        <p>This contest was deleted on another device.</p>
        <button className="btn-ghost" onClick={onBack}>← Back to dashboard</button>
      </main>
    );
  }
  if (open.status !== 'ready') return <main className="page"><p className="muted">Loading…</p></main>;

  const contest = open.contest;
  const markSaved = () => {
    if (draftSaved.current) return;
    draftSaved.current = true;
    onDraftSaved?.(view);
  };
  const setContest = (next: Contest) => {
    open.set(next);
    markSaved();
  };

  // The archive offer, shown only while its source still exists and is active.
  const offerSource = archiveOfferFrom ? summaries?.find((c) => c.id === archiveOfferFrom) : undefined;
  const closeArchiveOffer = () => {
    clearArchiveOffer(contestId);
    setArchiveOfferFrom(null);
  };
  const archiveSource = () => {
    if (archiveOfferFrom) {
      void contestLibrary()
        .transform(archiveOfferFrom, (fresh) => withArchived(fresh, true))
        .catch(() => {});
    }
    closeArchiveOffer();
  };

  /** Navigate to a pane from the sidebar (a plain switch, no pending scroll). */
  const selectPane = (next: PaneId) => {
    setPendingScroll(null);
    setView(next);
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
          <EditableContestTitle
            title={effectiveContestTitle(contest)}
            override={contest.titleOverride}
            autoName={contestDisplayName(contest.identity)}
            onChange={(v) => {
              open.update((c) => withTitleOverride(c, v));
              markSaved();
            }}
          />
          <p className="subtitle">Every change saves automatically.</p>
          {offerSource && !offerSource.archived && (
            <div className="update-notice" role="status">
              <span>
                You started this contest from <strong>{offerSource.name}</strong>. Archive it to tidy your dashboard?
              </span>
              <span className="update-notice-actions">
                <button type="button" className="btn-secondary" onClick={archiveSource}>
                  Archive it
                </button>
                <button type="button" className="btn-ghost" onClick={closeArchiveOffer}>
                  Not now
                </button>
              </span>
            </div>
          )}
          {open.notice && (
            <div className="update-notice" role="status">
              <span>Updated from another device</span>
              <button type="button" className="btn-ghost" aria-label="Dismiss" onClick={open.dismissNotice}>
                ✕
              </button>
            </div>
          )}
        </header>

        <UndoToast
          contestId={contestId}
          onUndo={async (checkpointId) => {
            if (!open.checkpoints) throw new Error('The contest is not open.');
            await open.checkpoints.restore(checkpointId);
          }}
        />

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

                {view === 'setup' && cmCarried && !cmNoteDismissed && (
                  <div className="update-notice" role="status">
                    <span>CM Info was filled from your last contest. Change anything that's different this time.</span>
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-label="Dismiss"
                      onClick={() => setCmNoteDismissed(true)}
                    >
                      ✕
                    </button>
                  </div>
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
                  onOpenContest={onOpenContest}
                />
              </>
            )}
          </main>
        </div>
      </div>
    </SectionOpenContext.Provider>
  );
}
