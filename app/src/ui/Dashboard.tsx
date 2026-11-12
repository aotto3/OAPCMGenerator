import { useRef, useState } from 'react';
import { contestDisplayName, createContest, duplicateContest, importContest, withArchived } from '../model/contest';
import type { Contest } from '../model/contest';
import { triggerContestFileDownload } from '../documents/generate';
import { reportContestExported, reportContestImported } from '../telemetry/telemetryClient';
import { contestLibrary } from '../storage/browserLibrary';
import type { ContestSummary } from '../storage/contestLibrary';
import { useContestAction, useContestList } from './contestHooks';
import {
  DEFAULT_SORT,
  SORT_KEYS,
  directionLabel,
  isSortDirection,
  isSortKey,
  sortContests,
  type SortDirection,
  type SortKey,
  type SortPref,
} from './contestSort';

/** Dashboard visibility filter (PRD #141). */
type ContestFilter = 'active' | 'archived' | 'all';
const FILTER_LABELS: Record<ContestFilter, string> = { active: 'Active', archived: 'Archived', all: 'All' };

function matchesFilter(summary: ContestSummary, filter: ContestFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'archived' ? summary.archived : !summary.archived;
}

// Sort preference persists per-device (a view preference, not contest data), so
// the dashboard reopens the way it was left. Guarded — any storage failure or a
// stale/invalid value falls back to the default rather than throwing.
const SORT_STORAGE_KEY = 'oap.dashboardSort';

function loadSortPref(): SortPref {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SortPref>;
      if (isSortKey(parsed.key) && isSortDirection(parsed.direction)) {
        return { key: parsed.key, direction: parsed.direction };
      }
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT_SORT;
}

function saveSortPref(pref: SortPref): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    /* persistence is best-effort */
  }
}

function lastEdited(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? '' : `last edited ${date.toLocaleString()}`;
}

// The contest date is a bare ISO yyyy-mm-dd; anchor it at local noon so parsing
// never lands on the previous day in timezones behind UTC (the model uses the
// same T12:00:00 trick — see autoDeadlineFor).
function contestDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso + 'T12:00:00');
  return isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// The row's second line: host school and last-edited note, each shown only when
// present and joined so no separator ever dangles. (The contest date rides on
// the first line next to the title.)
function rowMetaSecondary({ hostSchoolName, updatedAt }: ContestSummary): string {
  const school = hostSchoolName.trim();
  return [school ? `Host: ${school}` : '', lastEdited(updatedAt)].filter(Boolean).join(' · ');
}

export function Dashboard({
  onOpen,
  onCreate,
  onOpenSaved,
}: {
  onOpen: (id: string) => void;
  onCreate: (draft: Contest) => void;
  /** Persist a fully-formed new contest (import/duplicate), then open it. */
  onOpenSaved: (contest: Contest) => void | Promise<void>;
}) {
  // Live: local writes, pulls and deletes all refresh it.
  const contests = useContestList();
  const action = useContestAction();
  const [filter, setFilter] = useState<ContestFilter>('active');
  const [sort, setSort] = useState<SortPref>(loadSortPref);
  const fileInput = useRef<HTMLInputElement>(null);

  // Persist on every change so the choice survives a reload.
  function updateSort(next: SortPref) {
    setSort(next);
    saveSortPref(next);
  }

  // Opens an in-memory draft; nothing is stored until the first edit.
  function handleCreate() {
    onCreate(createContest());
  }

  // Import a contest file (the JSON bundled in every generated ZIP) as a NEW
  // contest. The model parses + migrates + rejects bad input; we only read the
  // file and surface a friendly error. Reset the input so re-picking the same
  // file fires onChange again.
  function handleImportFile(file: File) {
    action.run(`Couldn't import "${file.name}"`, async () => {
      const contest = importContest(await file.text());
      await onOpenSaved(contest);
      // Best-effort telemetry — never awaited, never blocks the import.
      reportContestImported(contest.id, contestDisplayName(contest.identity));
    });
  }

  function handleDuplicate(summary: ContestSummary) {
    action.run(`Couldn't duplicate "${summary.name}"`, async () => {
      const source = await contestLibrary().read(summary.id);
      if (!source) return; // deleted out from under us
      await onOpenSaved(duplicateContest(source));
    });
  }

  // Export the portable contest file (the ZIP's JSON, plus judge preferences),
  // then record a best-effort export event. The download drives the action; the
  // telemetry is fire-and-forget and never blocks it.
  async function handleExport(summary: ContestSummary) {
    const source = await contestLibrary().read(summary.id);
    if (!source) return; // deleted out from under us
    triggerContestFileDownload(source);
    reportContestExported(summary.id, summary.name);
  }

  function handleDelete(summary: ContestSummary) {
    if (!window.confirm(`Delete "${summary.name}"? This cannot be undone.`)) return;
    action.run(`Couldn't delete "${summary.name}"`, () => contestLibrary().remove(summary.id));
  }

  // Archive/unarchive is a reversible edit made without opening the contest; the
  // library reads it fresh, flips the flag, and persists (which syncs). A contest
  // deleted out from under us is simply skipped.
  function handleSetArchived(summary: ContestSummary, archived: boolean) {
    action.run(`Couldn't ${archived ? 'archive' : 'unarchive'} "${summary.name}"`, async () => {
      await contestLibrary().transform(summary.id, (fresh) => withArchived(fresh, archived));
    });
  }

  // The rows to render: current filter applied, then sorted by the chosen key.
  const visible = contests ? sortContests(contests.filter((c) => matchesFilter(c, filter)), sort) : [];

  return (
    <main className="page">
      <header className="page-header">
        <h1>🎭 OAP Contest Manager</h1>
        <p className="subtitle">UIL One-Act Play contest documents — 2.0</p>
      </header>

      <div className="toolbar">
        <h2>Your Contests</h2>
        <div className="toolbar-actions">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) handleImportFile(file);
            }}
          />
          <button className="btn-secondary" onClick={() => fileInput.current?.click()}>
            Import contest file
          </button>
          <button className="btn-primary" onClick={handleCreate}>
            + New Contest
          </button>
        </div>
      </div>

      {action.error && (
        <p className="import-error" role="alert">
          ⚠️ {action.error}
        </p>
      )}

      {contests && contests.length > 0 && (
        <div className="dashboard-controls">
          <div className="dashboard-filters" role="group" aria-label="Filter contests">
            {(['active', 'archived', 'all'] as const).map((f) => {
              const count = contests.filter((c) => matchesFilter(c, f)).length;
              return (
                <button
                  key={f}
                  className={filter === f ? 'filter-btn is-active' : 'filter-btn'}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {FILTER_LABELS[f]} ({count})
                </button>
              );
            })}
          </div>
          <div className="dashboard-sort">
            <label>
              Sort by{' '}
              <select
                value={sort.key}
                onChange={(e) => updateSort({ ...sort, key: e.target.value as SortKey })}
              >
                {SORT_KEYS.map(({ key, label }) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="visually-hidden">Order</span>
              <select
                value={sort.direction}
                onChange={(e) => updateSort({ ...sort, direction: e.target.value as SortDirection })}
              >
                {(['asc', 'desc'] as const).map((d) => (
                  <option key={d} value={d}>
                    {directionLabel(sort.key, d)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {contests === null ? (
        <p className="muted">Loading…</p>
      ) : contests.length === 0 ? (
        <p className="muted">No contests yet. Create one to get started.</p>
      ) : visible.length === 0 ? (
        <p className="muted">
          {filter === 'archived' ? 'No archived contests.' : 'No active contests — check Archived.'}
        </p>
      ) : (
        <ul className="contest-list">
          {visible.map((c) => (
            <li key={c.id} className={c.archived ? 'contest-row is-archived' : 'contest-row'}>
              <button className="contest-open" onClick={() => onOpen(c.id)}>
                <span className="contest-row-line contest-row-title">
                  <span className="contest-name">{c.name}</span>
                  {contestDate(c.contestDate) && (
                    <span className="muted"> · {contestDate(c.contestDate)}</span>
                  )}
                </span>
                {rowMetaSecondary(c) && <span className="contest-row-line muted">{rowMetaSecondary(c)}</span>}
              </button>
              <button
                className="btn-secondary"
                onClick={() => handleDuplicate(c)}
                aria-label={`Duplicate ${c.name}`}
              >
                Duplicate
              </button>
              <button
                className="btn-secondary"
                onClick={() => void handleExport(c)}
                aria-label={`Export ${c.name}`}
              >
                Export
              </button>
              <button
                className="btn-secondary"
                onClick={() => handleSetArchived(c, !c.archived)}
                aria-label={`${c.archived ? 'Unarchive' : 'Archive'} ${c.name}`}
              >
                {c.archived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                className="btn-danger"
                onClick={() => handleDelete(c)}
                aria-label={`Delete ${c.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
