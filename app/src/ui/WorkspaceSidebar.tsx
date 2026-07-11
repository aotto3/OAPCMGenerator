import { useEffect } from 'react';
import { PANES, QUICK_LINKS, type PaneId } from './paneRegistry';

/**
 * Workspace sidebar (PRD #127, Slice R2 #129) — the app's one navigation surface.
 * A loop over the pane registry: the five grouped panes, then the pinned Tools
 * zone. Pure navigation — no status, counts, or dots (status lives only on the
 * Readiness hub). One component, two presentations: a persistent rail at desktop
 * widths and an off-canvas drawer behind a hamburger at mobile widths, both
 * CSS-driven so the structure shown is identical. Colors come from theme tokens.
 *
 * The drawer's open state is owned by the Workspace (the hamburger lives in the
 * header); selecting a pane both navigates and closes the drawer.
 */
export function WorkspaceSidebar({
  current,
  onSelect,
  open,
  onClose,
}: {
  current: PaneId;
  onSelect: (pane: PaneId) => void;
  /** Drawer open (mobile only; ignored by the desktop rail). */
  open: boolean;
  onClose: () => void;
}) {
  const grouped = PANES.filter((p) => p.zone === 'panes');
  const tools = PANES.filter((p) => p.zone === 'tools');

  // Escape closes the mobile drawer (a no-op when it's already closed / on desktop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const paneButton = (id: PaneId, label: string, emoji: string) => (
    <button
      key={id}
      type="button"
      className={`ws-pane-btn${current === id ? ' is-active' : ''}`}
      aria-current={current === id ? 'page' : undefined}
      onClick={() => {
        onSelect(id);
        onClose();
      }}
    >
      <span className="ws-pane-emoji" aria-hidden>
        {emoji}
      </span>
      <span className="ws-pane-label">{label}</span>
    </button>
  );

  return (
    <>
      {/* Backdrop dims the content behind the mobile drawer; a no-op on desktop. */}
      <div
        className={`ws-drawer-backdrop${open ? ' is-open' : ''}`}
        aria-hidden
        onClick={onClose}
      />
      <nav
        className={`workspace-sidebar${open ? ' is-open' : ''}`}
        aria-label="Workspace navigation"
      >
        <div className="ws-zone">{grouped.map((p) => paneButton(p.id, p.label, p.emoji))}</div>
        <div className="ws-zone ws-zone-tools">
          <span className="ws-zone-label">Tools</span>
          {tools.map((p) => paneButton(p.id, p.label, p.emoji))}
        </div>

        {/* Quick Links (restored from v12) — external references, new tab. Not a
            pane; a sidebar-embedded link group living in the Tools zone. */}
        <div className="ws-zone ws-quick-links">
          <span className="ws-zone-label">Quick Links</span>
          {QUICK_LINKS.map((link) => (
            <a
              key={link.url}
              className="ws-quick-link"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="ws-pane-emoji" aria-hidden>
                {link.emoji}
              </span>
              <span className="ws-pane-label">{link.label}</span>
            </a>
          ))}
        </div>
      </nav>
    </>
  );
}
