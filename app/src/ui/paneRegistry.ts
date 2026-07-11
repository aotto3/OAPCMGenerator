/**
 * Pane registry — the single source of truth for the workspace's pane structure
 * (PRD #127, Slice R1 #128).
 *
 * Pure, dependency-free data + tiny pure functions. It defines which panes exist
 * and in what order, which modules live in each pane (canonical placements plus
 * the two declared mirrors), the total section→pane mapping, the Quick Links, and
 * the landing rule. Both the sidebar and the pane renderer (#129) are loops over
 * this module — the same total-map pattern as the document registry.
 *
 * NO UI here: no React, no storage, no model imports. `ModuleId` is this module's
 * own vocabulary (the `sec-<slug>` anchor slugs already used by Workspace.tsx),
 * so nothing needs to reach into the Contest type.
 */

/**
 * Every workspace module, named by the anchor slug Workspace.tsx already renders
 * as `sec-<slug>`. One id, `email`, covers both EmailComposer and EmailListBox —
 * they render together and the PRD homes them as one Tools entry — accounting for
 * all 16 rendered components in 15 ids.
 */
export type ModuleId =
  | 'cm'
  | 'identity'
  | 'details'
  | 'adjudicators'
  | 'schools'
  | 'plays'
  | 'companies'
  | 'draw'
  | 'compliance'
  | 'schedule'
  | 'critique'
  | 'results'
  | 'generate'
  | 'history'
  | 'email';

/** Every sidebar destination. Two zones: the five grouped panes, then pinned Tools. */
export type PaneId =
  | 'setup'
  | 'judges'
  | 'schools'
  | 'contest'
  | 'results'
  | 'readiness'
  | 'generate'
  | 'save'
  | 'email';

/** `panes` = the five functional groups; `tools` = the pinned cross-cutting zone. */
export type PaneZone = 'panes' | 'tools';

export interface PaneDef {
  id: PaneId;
  zone: PaneZone;
  label: string;
  emoji: string;
}

/** Display metadata for a module (label + emoji reused from WorkspaceNav.tsx). */
export interface ModuleMeta {
  label: string;
  emoji: string;
}

/** One module placed in a pane — canonical or mirror; read-only for the one mirror. */
export interface PaneModule {
  module: ModuleId;
  /** True when this placement is a mirror (rendered later, #130), not the canonical home. */
  mirror: boolean;
  /** Only the Schedule-preview-in-Setup mirror is read-only. */
  readOnly?: boolean;
}

/** A mirror declaration: `module` (canonical elsewhere) also shown in `pane`. */
export interface MirrorDef {
  module: ModuleId;
  pane: PaneId;
  /** Read-only rendering of the mirror (Schedule preview in Setup). */
  readOnly?: boolean;
}

/** Module label + emoji, reused verbatim from WorkspaceNav.tsx's section list. */
export const MODULE_META: Record<ModuleId, ModuleMeta> = {
  cm: { label: 'CM Info', emoji: '👤' },
  identity: { label: 'Identity', emoji: '📋' },
  details: { label: 'Details', emoji: '📅' },
  adjudicators: { label: 'Judges', emoji: '⚖️' },
  schools: { label: 'Schools', emoji: '🏫' },
  plays: { label: 'Plays', emoji: '🎭' },
  companies: { label: 'Companies', emoji: '👥' },
  draw: { label: 'Performance Order Draw', emoji: '🎟️' },
  compliance: { label: 'Compliance', emoji: '✅' },
  schedule: { label: 'Schedule', emoji: '🗓️' },
  critique: { label: 'Critique', emoji: '🎲' },
  results: { label: 'Results & Advancement', emoji: '🏆' },
  generate: { label: 'Generate Documents', emoji: '⬇️' },
  history: { label: 'Manual Save', emoji: '💾' },
  email: { label: 'Email', emoji: '✉️' },
};

/**
 * The sidebar destinations in render order: the five grouped panes, then the
 * pinned Tools zone (Readiness, Generate, Save, Email). Quick Links is NOT a pane
 * (see QUICK_LINKS) — it is a sidebar-embedded external-link group.
 */
export const PANES: readonly PaneDef[] = [
  { id: 'setup', zone: 'panes', label: 'Setup', emoji: '📝' },
  { id: 'judges', zone: 'panes', label: 'Judges', emoji: '⚖️' },
  { id: 'schools', zone: 'panes', label: 'Schools', emoji: '🏫' },
  { id: 'contest', zone: 'panes', label: 'Contest', emoji: '🎬' },
  { id: 'results', zone: 'panes', label: 'Results', emoji: '🏆' },
  { id: 'readiness', zone: 'tools', label: 'Readiness', emoji: '🎯' },
  { id: 'generate', zone: 'tools', label: 'Generate Documents', emoji: '⬇️' },
  { id: 'save', zone: 'tools', label: 'Manual Save', emoji: '💾' },
  { id: 'email', zone: 'tools', label: 'Email', emoji: '✉️' },
];

/**
 * Canonical home of every module — the total section→pane mapping. Typed as a
 * `Record<ModuleId, PaneId>` so adding a ModuleId without homing it fails
 * `npm run build` (the compile-time totality guarantee). Readiness jumps target
 * these canonical panes. `readiness` is a pane with no canonical modules (its
 * content is the Readiness page, not a workspace module).
 */
export const CANONICAL_HOME: Record<ModuleId, PaneId> = {
  cm: 'setup',
  identity: 'setup',
  details: 'setup',
  adjudicators: 'judges',
  schools: 'schools',
  plays: 'schools',
  companies: 'schools',
  compliance: 'schools',
  draw: 'contest',
  schedule: 'contest',
  critique: 'contest',
  results: 'results',
  generate: 'generate',
  history: 'save',
  email: 'email',
};

/**
 * Global module ordering. Per-pane canonical order is this list filtered to a
 * pane's canonical modules, which reproduces the PRD table's within-pane order.
 * A test asserts this covers every ModuleId exactly once.
 */
const MODULE_ORDER: readonly ModuleId[] = [
  'cm',
  'identity',
  'details',
  'adjudicators',
  'schools',
  'plays',
  'companies',
  'compliance',
  'draw',
  'schedule',
  'critique',
  'results',
  'generate',
  'history',
  'email',
];

/**
 * The exactly-two mirrors (PRD): Critique mirrored into Judges (fully editable —
 * critique assignment is part of both workflows) and the Schedule preview mirrored
 * into Setup (read-only, restoring the Details→schedule live-feedback loop).
 * Declared here; #129 renders canonical placements only, #130 flips these on.
 */
export const MIRRORS: readonly MirrorDef[] = [
  { module: 'critique', pane: 'judges' },
  { module: 'schedule', pane: 'setup', readOnly: true },
];

/**
 * Ordered placements for a pane: its canonical modules (in PRD-table order),
 * followed by any mirror targeting it. Both current mirrors sit last in their
 * pane per the table — Setup lists Schedule last; Judges lists Critique after
 * Judges — so appending reproduces the table exactly.
 */
export function paneModules(pane: PaneId): readonly PaneModule[] {
  const canonical: PaneModule[] = MODULE_ORDER.filter(
    (m) => CANONICAL_HOME[m] === pane,
  ).map((module) => ({ module, mirror: false }));
  const mirrored: PaneModule[] = MIRRORS.filter((m) => m.pane === pane).map((m) => ({
    module: m.module,
    mirror: true,
    ...(m.readOnly ? { readOnly: true as const } : {}),
  }));
  return [...canonical, ...mirrored];
}

/** The canonical pane a module belongs to (what Readiness jumps target). */
export function canonicalPane(module: ModuleId): PaneId {
  return CANONICAL_HOME[module];
}

/** The DOM anchor id Workspace.tsx renders for a module (`sec-<slug>`). */
export function moduleAnchorId(module: ModuleId): string {
  return `sec-${module}`;
}

/**
 * Landing destination: a fresh draft lands on Setup (start typing immediately);
 * a saved contest lands on Readiness (status + table of contents). A boolean, by
 * design — the registry stays free of the Contest type.
 */
export function landingPane(isDraft: boolean): PaneId {
  return isDraft ? 'setup' : 'readiness';
}

/**
 * v12's Quick Links — external references CMs need mid-contest, opened in a new
 * tab by the sidebar (#129/#130). Not a pane; a sidebar-embedded link group.
 * URLs/emoji ported verbatim from `_Templates/OAP Contest Setup.html` (never edit
 * it). Order matches the template.
 */
export const QUICK_LINKS: ReadonlyArray<{ label: string; emoji: string; url: string }> = [
  { label: 'Resources & Forms', emoji: '📄', url: 'https://www.uiltexas.org/theatre/resources-forms' },
  { label: 'UIL OAP Handbook', emoji: '📖', url: 'https://www.uiltexas.org/theatre/oap-handbook' },
  { label: 'Speechwire', emoji: '🗳️', url: 'https://manage.speechwire.com/tabroom/' },
  { label: 'Tabulation Tool', emoji: '🧮', url: 'https://www.uiltexas.org/theatre/high-school-one-act/tabulation' },
];
