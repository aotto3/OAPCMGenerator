/**
 * The one-time "Archive <source>?" offer after starting a contest from a past
 * one that is still active (PRD #304, #311). Per-device UI state, not contest
 * data: a map from the NEW contest's id to the source contest's id, kept in
 * guarded localStorage so the offer survives a refresh and is gone for good
 * once the CM archives or dismisses it.
 */
const STORAGE_KEY = 'oap.archiveOffers';

function load(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (e): e is [string, string] => typeof e[1] === 'string',
        ),
      );
    }
  } catch {
    /* fall through */
  }
  return {};
}

function save(map: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* best-effort */
  }
}

/** Remember to offer archiving `sourceId` when `newId` is first shown. */
export function recordArchiveOffer(newId: string, sourceId: string): void {
  save({ ...load(), [newId]: sourceId });
}

/** The source contest to offer archiving from `newId`, or null. */
export function pendingArchiveOffer(newId: string): string | null {
  return load()[newId] ?? null;
}

/** The offer was acted on (archived or dismissed): never show it again. */
export function clearArchiveOffer(newId: string): void {
  const map = load();
  if (!(newId in map)) return;
  delete map[newId];
  save(map);
}
