import { describe, expect, it } from 'vitest';
import {
  CANONICAL_HOME,
  MIRRORS,
  MODULE_META,
  PANES,
  QUICK_LINKS,
  canonicalPane,
  landingPane,
  moduleAnchorId,
  paneModules,
  type ModuleId,
  type PaneId,
} from './paneRegistry';

/** Every ModuleId, for totality assertions. */
const ALL_MODULES = Object.keys(CANONICAL_HOME) as ModuleId[];

describe('pane order and zones', () => {
  it('lists the five grouped panes then the four pinned tools, in order', () => {
    expect(PANES.map((p) => p.id)).toEqual([
      'setup',
      'judges',
      'schools',
      'contest',
      'results',
      'readiness',
      'generate',
      'save',
      'email',
    ]);
    expect(PANES.filter((p) => p.zone === 'panes').map((p) => p.id)).toEqual([
      'setup',
      'judges',
      'schools',
      'contest',
      'results',
    ]);
    expect(PANES.filter((p) => p.zone === 'tools').map((p) => p.id)).toEqual([
      'readiness',
      'generate',
      'save',
      'email',
    ]);
  });

  it('renames Run of Show to Contest and every pane carries a label + emoji', () => {
    expect(PANES.find((p) => p.id === 'contest')?.label).toBe('Contest');
    for (const p of PANES) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.emoji.length).toBeGreaterThan(0);
    }
  });
});

describe('per-pane module order (PRD mapping table)', () => {
  it('places canonical modules and mirrors exactly as the table specifies', () => {
    // Setup lists Schedule preview LAST as a read-only mirror.
    expect(paneModules('setup')).toEqual([
      { module: 'cm', mirror: false },
      { module: 'identity', mirror: false },
      { module: 'details', mirror: false },
      { module: 'schedule', mirror: true, readOnly: true },
    ]);
    // Judges lists Critique after Judges as an editable mirror.
    expect(paneModules('judges')).toEqual([
      { module: 'adjudicators', mirror: false },
      { module: 'critique', mirror: true },
    ]);
    expect(paneModules('schools')).toEqual([
      { module: 'schools', mirror: false },
      { module: 'plays', mirror: false },
      { module: 'companies', mirror: false },
      { module: 'compliance', mirror: false },
    ]);
    expect(paneModules('contest')).toEqual([
      { module: 'draw', mirror: false },
      { module: 'schedule', mirror: false },
      { module: 'critique', mirror: false },
    ]);
    expect(paneModules('results')).toEqual([{ module: 'results', mirror: false }]);
    expect(paneModules('generate')).toEqual([{ module: 'generate', mirror: false }]);
    expect(paneModules('save')).toEqual([{ module: 'history', mirror: false }]);
    expect(paneModules('email')).toEqual([{ module: 'email', mirror: false }]);
  });

  it('gives the Readiness pane no workspace modules', () => {
    expect(paneModules('readiness')).toEqual([]);
  });
});

describe('totality of the section→pane mapping', () => {
  it('homes every ModuleId in at least one pane', () => {
    const placed = new Set<ModuleId>();
    for (const p of PANES) {
      for (const pm of paneModules(p.id)) placed.add(pm.module);
    }
    for (const m of ALL_MODULES) expect(placed.has(m)).toBe(true);
  });

  it('places every ModuleId exactly once as a canonical (non-mirror) module', () => {
    const canonicalCounts = new Map<ModuleId, number>();
    for (const p of PANES) {
      for (const pm of paneModules(p.id)) {
        if (!pm.mirror) canonicalCounts.set(pm.module, (canonicalCounts.get(pm.module) ?? 0) + 1);
      }
    }
    for (const m of ALL_MODULES) expect(canonicalCounts.get(m)).toBe(1);
    // No stray canonical modules beyond the union.
    expect(canonicalCounts.size).toBe(ALL_MODULES.length);
  });

  it('has metadata for every ModuleId', () => {
    for (const m of ALL_MODULES) {
      expect(MODULE_META[m].label.length).toBeGreaterThan(0);
      expect(MODULE_META[m].emoji.length).toBeGreaterThan(0);
    }
    // The adjudicators module is labelled "Judges".
    expect(MODULE_META.adjudicators.label).toBe('Judges');
  });
});

describe('mirrors', () => {
  it('declares exactly the two PRD mirrors', () => {
    expect(MIRRORS).toEqual([
      { module: 'critique', pane: 'judges' },
      { module: 'schedule', pane: 'setup', readOnly: true },
    ]);
  });

  it('mirrors Critique into Judges (editable) and Schedule into Setup (read-only)', () => {
    const critique = MIRRORS.find((m) => m.module === 'critique');
    expect(critique).toEqual({ module: 'critique', pane: 'judges' });
    expect(critique?.readOnly).toBeUndefined();

    const schedule = MIRRORS.find((m) => m.module === 'schedule');
    expect(schedule).toEqual({ module: 'schedule', pane: 'setup', readOnly: true });
  });

  it('keeps mirrored modules canonically in Contest', () => {
    expect(canonicalPane('critique')).toBe('contest');
    expect(canonicalPane('schedule')).toBe('contest');
  });
});

describe('canonicalPane', () => {
  it('agrees with CANONICAL_HOME for every module', () => {
    for (const m of ALL_MODULES) expect(canonicalPane(m)).toBe(CANONICAL_HOME[m]);
  });

  it('maps every canonical home to a real pane', () => {
    const paneIds = new Set<PaneId>(PANES.map((p) => p.id));
    for (const m of ALL_MODULES) expect(paneIds.has(canonicalPane(m))).toBe(true);
  });
});

describe('moduleAnchorId', () => {
  it('round-trips every ModuleId to its sec-* anchor', () => {
    for (const m of ALL_MODULES) expect(moduleAnchorId(m)).toBe(`sec-${m}`);
  });
});

describe('QUICK_LINKS', () => {
  it('carries the four v12 entries with their exact URLs', () => {
    expect(QUICK_LINKS).toEqual([
      { label: 'Resources & Forms', emoji: '📄', url: 'https://www.uiltexas.org/theatre/resources-forms' },
      { label: 'UIL OAP Handbook', emoji: '📖', url: 'https://www.uiltexas.org/theatre/oap-handbook' },
      { label: 'Speechwire', emoji: '🗳️', url: 'https://manage.speechwire.com/tabroom/' },
      { label: 'Tabulation Tool', emoji: '🧮', url: 'https://www.uiltexas.org/theatre/high-school-one-act/tabulation' },
    ]);
  });
});

describe('landingPane', () => {
  it('lands a fresh draft on Setup and a saved contest on Readiness', () => {
    expect(landingPane(true)).toBe('setup');
    expect(landingPane(false)).toBe('readiness');
  });
});
