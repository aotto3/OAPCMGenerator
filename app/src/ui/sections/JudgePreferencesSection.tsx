import { useId, useState } from 'react';
import {
  addCustomPreferenceList,
  addRankedJudge,
  addVetoedJudge,
  mergeJudgeNames,
  moveRankedJudge,
  removeCustomPreferenceList,
  removeRankedJudge,
  removeVetoedJudge,
  renameCustomPreferenceList,
  setJudgeUnavailable,
  type Contest,
} from '../../model/contest';
import {
  activePreferenceLists,
  addAsJudge,
  callListText,
  combinePreferenceLists,
  enteredJudgeNames,
  firstOpenJudgeSlot,
  judgeSlotNumber,
  preferenceProgress,
  preferencesAvailable,
  type ActivePreferenceList,
  type PreferenceConflict,
} from '../../model/judgePreferences';
import { suggestJudges, type RosterJudge } from '../../model/ttaoRoster';
import { TTAO_SNAPSHOT } from '../../model/ttaoRosterSnapshot';
import { CopyButton } from './fields';
import { Section } from './Section';

/**
 * Judge Preferences workspace section (PRD #202). One list per school (per district
 * at BiDistrict) plus any custom lists, each holding ranked judges and vetoes, and the
 * live combined call list, whose order is always computed. Hidden where the state
 * picks judges. Name entry suggests from the bundled TTAO snapshot and names already
 * in this contest, and any typed name is accepted. Reads/writes only through the pure
 * model updaters, so autosave/sync/export carry it with no plumbing of its own. UI
 * is untested by convention; the calculator and model seams are tested.
 */
export function JudgePreferencesSection({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  if (!preferencesAvailable(contest.identity.contestLevel)) return null;

  const lists = activePreferenceLists(contest);
  const progress = preferenceProgress(lists);
  const { callList, vetoed, conflicts } = combinePreferenceLists(lists, contest.judgePreferences.unavailable);
  const copyText = callListText(callList);
  const slotsFull = firstOpenJudgeSlot(contest) === null;
  const submitter = contest.identity.contestLevel === 'BiDistrict' ? 'district' : 'school';

  return (
    <Section title="🗳️ Judge Preferences" badge="Optional" defaultOpen={false}>
      <p className="note-box">
        Enter the judges each {submitter} prefers, best first, plus any vetoes, and the call list below combines
        them. One veto takes a judge off the call list. Rankings and vetoes stay out of generated documents
        and the Email tool, but they are saved in contest files, including the one in the Generate Documents
        ZIP, so <strong>sharing a contest file shares its preferences</strong>.
      </p>
      <div className="pref-progress" role="status">
        {progress.entered} of {progress.total} entered
      </div>
      {TTAO_SNAPSHOT.judges.length > 0 && (
        <p className="muted pref-roster-note">
          Name suggestions use the TTAO adjudicator list as of {snapshotDate(TTAO_SNAPSHOT.asOf)}, plus names
          already in this contest. You can type any name.
        </p>
      )}
      <div className="pref-lists">
        {lists.map((list) => (
          <PreferenceListCard
            key={list.id}
            contest={contest}
            list={list}
            conflicts={conflicts.filter((c) => c.listId === list.id)}
            onChange={onChange}
          />
        ))}
      </div>
      <div className="pref-custom-add">
        <NameAdder
          placeholder="Custom list name, e.g. District committee"
          buttonLabel="+ Add list"
          ariaLabel="Add a custom list"
          onAdd={(name) => onChange(addCustomPreferenceList(contest, name))}
        />
      </div>

      <div className="section-divider">Call list</div>
      {callList.length === 0 ? (
        <p className="muted">No judges to call yet.</p>
      ) : (
        <div className="pref-call-scroll">
          <table className="pref-call-list">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Judge</th>
                <th scope="col">Points</th>
                <th scope="col">Lists</th>
                <th scope="col">Unavailable</th>
                <th scope="col">Hire</th>
              </tr>
            </thead>
            <tbody>
              {callList.map((entry, i) => {
                const slot = judgeSlotNumber(contest, entry.name);
                return (
                  <tr key={entry.name} className={entry.unavailable ? 'pref-unavailable' : undefined}>
                    <td>{i + 1}</td>
                    <td>
                      {entry.name}
                      {entry.tied && (
                        <span className="pref-tied" title="Tied after every tiebreaker. Call in any order.">
                          Tied
                        </span>
                      )}
                      {slot !== null && <span className="pref-hired">Judge {slot}</span>}
                    </td>
                    <td>{entry.points}</td>
                    <td>{entry.listCount}</td>
                    <td className="pref-control">
                      <input
                        type="checkbox"
                        checked={entry.unavailable}
                        aria-label={`${entry.name} is unavailable`}
                        onChange={(e) => onChange(setJudgeUnavailable(contest, entry.name, e.target.checked))}
                      />
                    </td>
                    <td className="pref-control">
                      {slot === null && (
                        <button
                          type="button"
                          className="btn-util"
                          disabled={slotsFull}
                          title={slotsFull ? 'All judge slots are full' : undefined}
                          aria-label={`Add ${entry.name} as judge`}
                          onClick={() => onChange(addAsJudge(contest, entry.name))}
                        >
                          Add as judge
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {copyText && (
        <div className="pref-copy">
          <CopyButton label="Copy list" getText={() => copyText} />
        </div>
      )}

      {vetoed.length > 0 && (
        <>
          <div className="section-divider">Vetoed</div>
          <div className="pref-call-scroll">
            <table className="pref-call-list">
              <thead>
                <tr>
                  <th scope="col">Judge</th>
                  <th scope="col">Vetoed by</th>
                </tr>
              </thead>
              <tbody>
                {vetoed.map((entry) => (
                  <tr key={entry.name}>
                    <td>{entry.name}</td>
                    <td>{entry.vetoedBy.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {vetoed.map((entry) => {
            const slot = judgeSlotNumber(contest, entry.name);
            return (
              slot !== null && (
                <p key={entry.name} className="pref-warning" role="alert">
                  {entry.name} is vetoed but is in the Judge {slot} slot. The slot is left as it is for you to review.
                </p>
              )
            );
          })}
        </>
      )}

      <MergeJudges contest={contest} names={[...callList, ...vetoed].map((e) => e.name)} onChange={onChange} />
    </Section>
  );
}

/** Merges two spellings of one judge, from the names on the call list or the Vetoed section. */
function MergeJudges({
  contest,
  names,
  onChange,
}: {
  contest: Contest;
  names: string[];
  onChange: (next: Contest) => void;
}) {
  const [keepChoice, setKeep] = useState('');
  const [mergeChoice, setMerge] = useState('');
  if (names.length < 2) return null;

  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const keep = names.includes(keepChoice) ? keepChoice : '';
  const merge = names.includes(mergeChoice) && mergeChoice !== keep ? mergeChoice : '';
  const mergeSlot = merge ? judgeSlotNumber(contest, merge) : null;

  function submit() {
    onChange(mergeJudgeNames(contest, keep, merge));
    setKeep('');
    setMerge('');
  }

  return (
    <>
      <div className="section-divider">Merge duplicate names</div>
      <p className="muted">
        If two names are the same person, merge them to combine their points. The kept spelling replaces the
        other on every list, and any Unavailable mark moves to it. A merge can only be undone by editing the
        lists by hand.
      </p>
      <div className="pref-merge">
        <label className="field">
          Keep this spelling
          <select value={keep} onChange={(e) => setKeep(e.target.value)}>
            <option value="">Choose a name</option>
            {sorted.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Merge this name into it
          <select value={merge} onChange={(e) => setMerge(e.target.value)}>
            <option value="">Choose a name</option>
            {sorted
              .filter((name) => name !== keep)
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        </label>
        <button type="button" className="btn-util" disabled={!keep || !merge} onClick={submit}>
          Merge names
        </button>
      </div>
      {mergeSlot !== null && (
        <p className="pref-warning" role="alert">
          {merge} is in the Judge {mergeSlot} slot. Merging won't change the slot, so update it in the Judges section
          if you want the kept spelling there.
        </p>
      )}
    </>
  );
}

/** A YYYY-MM-DD date in words. Noon keeps it on the same day in every time zone. */
function snapshotDate(asOf: string): string {
  return new Date(`${asOf}T12:00:00`).toLocaleDateString('en-US', { dateStyle: 'long' });
}

function PreferenceListCard({
  contest,
  list,
  conflicts,
  onChange,
}: {
  contest: Contest;
  list: ActivePreferenceList;
  conflicts: PreferenceConflict[];
  onChange: (next: Contest) => void;
}) {
  const { ref } = list;
  const entered = enteredJudgeNames(contest);
  const suggestFor = (exclude: string[]) => (query: string) =>
    suggestJudges(query, { roster: TTAO_SNAPSHOT.judges, entered, exclude });
  return (
    <div className="pref-list">
      {ref.kind === 'custom' ? (
        <CustomListHeader contest={contest} list={list} id={ref.id} onChange={onChange} />
      ) : (
        <div className="school-label">{list.label}</div>
      )}
      {list.ranked.length > 0 && (
        <ol className="pref-ranked">
          {list.ranked.map((name, i) => (
            <li key={name} className="pref-ranked-row">
              <span className="pref-rank">{i + 1}.</span>
              <span className="pref-name">{name}</span>
              <div className="roster-row-controls">
                <button
                  type="button"
                  className="roster-btn"
                  title="Move up"
                  aria-label={`Move ${name} up`}
                  disabled={i === 0}
                  onClick={() => onChange(moveRankedJudge(contest, ref, i, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="roster-btn"
                  title="Move down"
                  aria-label={`Move ${name} down`}
                  disabled={i === list.ranked.length - 1}
                  onClick={() => onChange(moveRankedJudge(contest, ref, i, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="roster-btn roster-btn-remove"
                  title="Remove"
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange(removeRankedJudge(contest, ref, i))}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <NameAdder
        placeholder="Judge name"
        ariaLabel={`Add a judge to ${list.label}`}
        suggest={suggestFor(list.ranked)}
        onAdd={(name) => onChange(addRankedJudge(contest, ref, name))}
      />

      <div className="pref-subheading">Vetoes</div>
      {list.vetoes.length > 0 && (
        <ul className="pref-ranked">
          {list.vetoes.map((name, i) => (
            <li key={name} className="pref-ranked-row">
              <span className="pref-name">{name}</span>
              <div className="roster-row-controls">
                <button
                  type="button"
                  className="roster-btn roster-btn-remove"
                  title="Remove veto"
                  aria-label={`Remove veto of ${name}`}
                  onClick={() => onChange(removeVetoedJudge(contest, ref, i))}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <NameAdder
        placeholder="Name to veto"
        buttonLabel="+ Veto"
        ariaLabel={`Add a veto to ${list.label}`}
        suggest={suggestFor(list.vetoes)}
        onAdd={(name) => onChange(addVetoedJudge(contest, ref, name))}
      />

      {conflicts.map((conflict) => (
        <p key={conflict.name} className="pref-warning" role="alert">
          {conflict.name} is both ranked and vetoed on this list. The veto wins until you remove one.
        </p>
      ))}
    </div>
  );
}

/** A custom list's editable name and remove button. Removing a list with names asks first. */
function CustomListHeader({
  contest,
  list,
  id,
  onChange,
}: {
  contest: Contest;
  list: ActivePreferenceList;
  id: string;
  onChange: (next: Contest) => void;
}) {
  const name = contest.judgePreferences.customLists.find((l) => l.id === id)?.name ?? '';

  function remove() {
    const hasNames = list.ranked.length > 0 || list.vetoes.length > 0;
    if (hasNames && !window.confirm(`Remove "${list.label}" and the names on it?`)) return;
    onChange(removeCustomPreferenceList(contest, id));
  }

  return (
    <div className="pref-list-header">
      <input
        type="text"
        value={name}
        placeholder={list.label}
        aria-label={`Rename ${list.label}`}
        onChange={(e) => onChange(renameCustomPreferenceList(contest, id, e.target.value))}
      />
      <button
        type="button"
        className="roster-btn roster-btn-remove"
        title="Remove list"
        aria-label={`Remove list ${list.label}`}
        onClick={remove}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * A name input with its add button; Enter also adds, and the input clears after. With
 * `suggest`, it offers matches to click or arrow through. Suggestions never block typing,
 * so Enter with none highlighted adds the name as typed.
 */
function NameAdder({
  placeholder,
  buttonLabel = '+ Add',
  ariaLabel,
  suggest,
  onAdd,
}: {
  placeholder: string;
  buttonLabel?: string;
  ariaLabel: string;
  suggest?: (query: string) => RosterJudge[];
  onAdd: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const listId = useId();

  const suggestions = open && suggest ? suggest(draft) : [];
  const expanded = suggestions.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;

  function add(name: string) {
    if (!name.trim()) return;
    onAdd(name);
    setDraft('');
    setHighlight(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(suggestions[highlight]?.name ?? draft);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
    } else if (expanded && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight((i) => (i + step + suggestions.length + (i < 0 && step < 0 ? 1 : 0)) % suggestions.length);
    }
  }

  return (
    <div className="pref-add">
      <div className="pref-suggest">
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          role={suggest ? 'combobox' : undefined}
          aria-autocomplete={suggest ? 'list' : undefined}
          aria-expanded={suggest ? expanded : undefined}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && highlight >= 0 ? optionId(highlight) : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setHighlight(-1);
          }}
          onKeyDown={onKeyDown}
        />
        {expanded && (
          <ul id={listId} className="pref-suggest-list" role="listbox" aria-label="Suggested names">
            {suggestions.map((judge, i) => (
              <li
                key={optionId(i)}
                id={optionId(i)}
                role="option"
                aria-selected={i === highlight}
                className={i === highlight ? 'pref-suggest-active' : undefined}
                // Keeps focus in the input, so the blur doesn't close the list before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(judge.name)}
              >
                <span>{judge.name}</span>
                {(judge.city || judge.esc) && (
                  <span className="pref-suggest-detail">{[judge.city, judge.esc].filter(Boolean).join(' · ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="btn-util" disabled={!draft.trim()} onClick={() => add(draft)}>
        {buttonLabel}
      </button>
    </div>
  );
}
