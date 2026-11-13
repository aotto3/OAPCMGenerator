/**
 * Contest route codec (PRD #304, slice #305). Pure: a pathname in, a route out,
 * and back. The address bar mirrors which contest and pane are open so a
 * refresh keeps the CM's place and the browser's Back/Forward step through
 * panes. No router library: App/Workspace push and pop these paths themselves.
 *
 * Shapes:
 *   /                       → dashboard
 *   /contest/<id>           → contest, no pane (the landing rule applies)
 *   /contest/<id>/<pane>    → contest at that pane
 *
 * Anything else (including an unknown pane name) degrades gracefully: unknown
 * paths are the dashboard, unknown panes are "no pane". The public questionnaire
 * path (/q/<token>) is branched off in App before this codec is ever consulted.
 */
import { PANES, type PaneId } from './paneRegistry';

export type ContestRoute =
  | { kind: 'dashboard' }
  | { kind: 'contest'; id: string; pane?: PaneId };

const PANE_IDS = new Set<string>(PANES.map((p) => p.id));

function isPaneId(value: string): value is PaneId {
  return PANE_IDS.has(value);
}

/** Pathname → route. Never throws; unrecognized input is the dashboard. */
export function parseRoute(pathname: string): ContestRoute {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'contest' || parts.length < 2 || parts.length > 3) return { kind: 'dashboard' };
  let id: string;
  try {
    id = decodeURIComponent(parts[1]);
  } catch {
    return { kind: 'dashboard' };
  }
  if (!id.trim()) return { kind: 'dashboard' };
  const pane = parts[2];
  return pane && isPaneId(pane) ? { kind: 'contest', id, pane } : { kind: 'contest', id };
}

/** Route → pathname. The inverse of parseRoute for every route it produces. */
export function formatRoute(route: ContestRoute): string {
  if (route.kind === 'dashboard') return '/';
  const base = `/contest/${encodeURIComponent(route.id)}`;
  return route.pane ? `${base}/${route.pane}` : base;
}
