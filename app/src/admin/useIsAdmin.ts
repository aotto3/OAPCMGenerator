import { useEffect, useState } from 'react';
import { probeAdmin } from './adminClient';

/**
 * Probes the am-I-admin endpoint once the user is signed in. Regular users get
 * a 404 (→ false) and never learn the panel exists; only a positive answer
 * flips this true, gating the admin entry point in the account bar. Re-probes
 * whenever the signed-in state changes.
 */
export function useIsAdmin(enabled: boolean): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIsAdmin(false);
      return;
    }
    let active = true;
    void probeAdmin().then((ok) => {
      if (active) setIsAdmin(ok);
    });
    return () => {
      active = false;
    };
  }, [enabled]);
  return isAdmin;
}
