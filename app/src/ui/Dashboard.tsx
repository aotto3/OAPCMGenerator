import { useEffect, useRef, useState } from 'react';
import { contestDisplayName, createContest, duplicateContest, importContest, withArchived } from '../model/contest';
import type { Contest } from '../model/contest';
import { triggerContestFileDownload } from '../documents/generate';
import { reportContestExported, reportContestImported } from '../telemetry/telemetryClient';
import {
  deleteContest,
  getContest,
  listContests,
  onContestPulled,
  saveContest,
  type ContestSummary,
} from '../storage/contestStore';
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
  const [contests, setContests] = useState<ContestSummary[] | null>(null);
  const [filter, setFilter] = useState<ContestFilter>('active');
  const [sort, setSort] = useState<SortPref>(loadSortPref);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Persist on every change so the choice survives a reload.
  function updateSort(next: SortPref) {
    setSort(next);
    saveSortPref(next);
  }

  useEffect(() => {
    let active = true;
    const refresh = () => void listContests().then((list) => active && setContests(list));
    refresh();
    // Background sync pulls land in IndexedDB without re-rendering us; refresh
    // the list when one arrives so a pull while the dashboard is open shows up
    // without a manual reload (Slice 14 gap, closed in Slice 15 / #28).
    const off = onContestPulled(refresh);
    return () => {
      active = false;
      off();
    };
  }, []);

  // Opens an in-memory draft; nothing is stored until the first edit.
  function handleCreate() {
    onCreate(createContest());
  }

  // Import a contest file (the JSON bundled in every generated ZIP) as a NEW
  // contest. The model parses + migrates + rejects bad input; we only read the
  // file and surface a friendly error. Reset the input so re-picking the same
  // file fires onChange again.
  async function handleImportFile(file: File) {
    setImportError(null);
    try {
      const contest = importContest(await file.text());
      await onOpenSaved(contest);
      // Best-effort telemetry — never awaited, never blocks the import.
      reportContestImported(contest.id, contestDisplayName(contest.identity));
    } catch (err) {
      setImportError(
        `Couldn't import "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function handleDuplicate(summary: ContestSummary) {
    const source = await getContest(summary.id);
    if (!source) return; // deleted out from under us
    await onOpenSaved(duplicateContest(source));
  }

  // Export the portable contest file (the same JSON bundled in a generated ZIP),
  // then record a best-effort export event. The download drives the action; the
  // telemetry is fire-and-forget and never blocks it.
  async function handleExport(summary: ContestSummary) {
    const source = await getContest(summary.id);
    if (!source) return; // deleted out from under us
    triggerContestFileDownload(source);
    reportContestExported(summary.id, summary.name);
  }

  async function handleDelete(summary: ContestSummary) {
    if (!window.confirm(`Delete "${summary.name}"? This cannot be undone.`)) return;
    await deleteContest(summary.id);
    setContests(await listContests());
  }

  // Archive/unarchive is a reversible edit made without opening the contest:
  // load it, flip the flag, persist (which syncs), and refresh the list.
  async function handleSetArchived(summary: ContestSummary, archived: boolean) {
    const source = await getContest(summary.id);
    if (!source) return; // deleted out from under us
    await saveContest(withArchived(source, archived));
    setContests(await listContests());
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
              if (file) void handleImportFile(file);
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

      {importError && (
        <p className="import-error" role="alert">
          ⚠️ {importError}
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
                onClick={() => void handleDuplicate(c)}
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
                onClick={() => void handleSetArchived(c, !c.archived)}
                aria-label={`${c.archived ? 'Unarchive' : 'Archive'} ${c.name}`}
              >
                {c.archived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                className="btn-danger"
                onClick={() => void handleDelete(c)}
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
