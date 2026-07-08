/**
 * The engine's SyncStore, implemented over this app's IndexedDB stores. It is
 * the glue between the sync engine and the local persistence layer, and it does
 * exactly three things: list what we have, build an upload bundle for one
 * contest, and apply a pulled bundle. No network, no reconciliation logic — that
 * lives in syncEngine.ts / syncReconcile.ts.
 *
 * The upload bundle is assembled from the already-serialized contest envelope
 * (getContestRecord) plus its checkpoints, via bundleFromEnvelope — so the
 * device-only stripping serializeContest performed is inherited verbatim and no
 * Speechwire credential can reach the wire.
 */
import { bundleFromEnvelope, parseSyncBundle } from '../model/syncBundle';
import { listCheckpoints } from './checkpointStore';
import { getContestRecord, listContests, putPulledContest } from './contestStore';
import type { SyncStore } from './syncEngine';

export const browserSyncStore: SyncStore = {
  async listLocal() {
    const summaries = await listContests();
    return summaries.map(({ id, updatedAt }) => ({ id, updatedAt }));
  },

  async loadBundle(id) {
    const record = await getContestRecord(id);
    if (!record) return undefined;
    const checkpoints = await listCheckpoints(id);
    return {
      name: record.name,
      updatedAt: record.updatedAt,
      payload: bundleFromEnvelope(record.payload, checkpoints),
    };
  },

  async applyRemote(_id, remote) {
    // The contest id travels inside the bundle; putPulledContest keys off it.
    const { contest, checkpoints } = parseSyncBundle(remote.payload);
    await putPulledContest(contest, checkpoints, remote.updatedAt);
  },
};
