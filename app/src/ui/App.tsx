import { useState } from 'react';
import { Dashboard } from './Dashboard';
import { Workspace } from './Workspace';

/**
 * Dashboard-first flow: contest list → contest workspace → back.
 * Navigation is a single piece of state for now; a router can replace it
 * in a later slice without touching Dashboard/Workspace internals.
 */
export function App() {
  const [openContestId, setOpenContestId] = useState<string | null>(null);

  return openContestId === null ? (
    <Dashboard onOpen={setOpenContestId} />
  ) : (
    <Workspace contestId={openContestId} onBack={() => setOpenContestId(null)} />
  );
}
