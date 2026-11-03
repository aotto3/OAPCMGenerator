import { useState } from 'react';
import {
  addCustomPreferenceList,
  addRankedJudge,
  addVetoedJudge,
  moveRankedJudge,
  removeCustomPreferenceList,
  removeRankedJudge,
  removeVetoedJudge,
  renameCustomPreferenceList,
  type Contest,
} from '../../model/contest';
import {
  activePreferenceLists,
  combinePreferenceLists,
  preferenceProgress,
  preferencesAvailable,
  type ActivePreferenceList,
  type PreferenceConflict,
} from '../../model/judgePreferences';
import { Section } from './Section';

/**
 * Judge Preferences workspace section (PRD #202). One list per school (per district
 * at BiDistrict) plus any custom lists, each holding ranked judges and vetoes, and the
 * live combined call list, whose order is always computed. Hidden where the state
 * picks judges. Reads/writes only through the pure
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
  const { callList, vetoed, conflicts } = combinePreferenceLists(lists);
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
              </tr>
            </thead>
            <tbody>
              {callList.map((entry, i) => (
                <tr key={entry.name}>
                  <td>{i + 1}</td>
                  <td>
                    {entry.name}
                    {entry.tied && (
                      <span className="pref-tied" title="Tied after every tiebreaker. Call in any order.">
                        Tied
                      </span>
                    )}
                  </td>
                  <td>{entry.points}</td>
                  <td>{entry.listCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        </>
      )}
    </Section>
  );
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

/** A name input with its add button; Enter also adds, and the input clears after. */
function NameAdder({
  placeholder,
  buttonLabel = '+ Add',
  ariaLabel,
  onAdd,
}: {
  placeholder: string;
  buttonLabel?: string;
  ariaLabel: string;
  onAdd: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft('');
  }

  return (
    <div className="pref-add">
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
      />
      <button type="button" className="btn-util" disabled={!draft.trim()} onClick={add}>
        {buttonLabel}
      </button>
    </div>
  );
}
