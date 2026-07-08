/**
 * Service-worker update prompt (Slice 15, issue #28).
 *
 * The "no stuck stale caches" AC, done deliberately. vite-plugin-pwa is
 * configured with registerType: 'prompt', so when a new deploy is detected the
 * new service worker installs and WAITS instead of auto-reloading. This banner
 * (subtle, matching the SyncStatus indicator's restraint) surfaces that a new
 * version is ready and lets the user apply it at a safe moment — never mid-edit
 * or mid-Generate on contest day. Clicking Update calls updateServiceWorker(true),
 * which messages SKIP_WAITING; the new SW activates and the page reloads once.
 *
 * useRegisterSW (from virtual:pwa-register/react) both registers the SW on mount
 * and exposes its lifecycle. This is the ONLY place the SW is registered — the
 * plugin's auto-inject is disabled (injectRegister: false in vite.config).
 *
 * Rendering is a no-op in dev and in browsers without service-worker support:
 * the hook simply never flips needRefresh/offlineReady, so nothing shows.
 */
import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  // A new version is waiting: offer to apply it. This takes precedence over the
  // one-time "offline ready" confirmation.
  if (needRefresh) {
    return (
      <div className="update-toast" role="status" aria-live="polite">
        <span>A new version is available.</span>
        <button className="btn-primary btn-sm" onClick={() => void updateServiceWorker(true)}>
          Update
        </button>
        <button
          className="btn-ghost btn-sm"
          onClick={() => setNeedRefresh(false)}
          aria-label="Dismiss update notice"
        >
          Later
        </button>
      </div>
    );
  }

  // First successful install: a brief, dismissible confirmation that the app now
  // works offline. Not required by the AC, but it makes the offline guarantee
  // visible the first time it becomes true.
  if (offlineReady) {
    return (
      <div className="update-toast" role="status" aria-live="polite">
        <span>Ready to work offline.</span>
        <button
          className="btn-ghost btn-sm"
          onClick={() => setOfflineReady(false)}
          aria-label="Dismiss offline-ready notice"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
