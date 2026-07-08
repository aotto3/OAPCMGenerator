/**
 * React glue for the background sync engine. The engine lives in the storage
 * layer (storage/browserSync.ts); this hook only starts it while the user is
 * signed in and surfaces its status for the indicator. No sync logic here — the
 * UI never drives reconciliation, it just reflects it.
 */
import { useEffect, useState } from 'react';
import { getSyncEngine, startBrowserSync } from '../storage/browserSync';
import type { SyncStatus } from '../storage/syncEngine';

export function useSync(enabled: boolean): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncEngine().getStatus());

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = getSyncEngine().subscribe(setStatus);
    const stop = startBrowserSync();
    return () => {
      unsubscribe();
      stop();
    };
  }, [enabled]);

  return status;
}
