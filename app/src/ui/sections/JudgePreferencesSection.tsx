import { useState } from 'react';
import {
  addRankedJudge,
  moveRankedJudge,
  removeRankedJudge,
  type Contest,
} from '../../model/contest';
import {
  activePreferenceLists,
  combinePreferenceLists,
  preferenceProgress,
  preferencesAvailable,
  type PreferenceList,
} from '../../model/judgePreferences';
import { Section } from './Section';

/**
 * Judge Preferences workspace section (PRD #202). One ranked list per school and
 * the live combined call list, whose order is always computed. Hidden where the
 * state picks judges. Reads/writes only through the pure model updaters, so
 * autosave/sync/export carry it with no plumbing of its own. UI is untested by
 * convention; the calculator and model seams are tested.
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
  const callList = combinePreferenceLists(lists);

  return (
    <Section title="🗳️ Judge Preferences" badge="Optional" defaultOpen={false}>
      <p className="note-box">
        Enter the judges each school prefers, best first, and the call list below combines them. Rankings
        stay out of generated documents and the Email tool, but they are saved in contest files, including
        the one in the Generate Documents ZIP, so <strong>sharing a contest file shares its preferences</strong>.
      </p>
      <div className="pref-progress" role="status">
        {progress.entered} of {progress.total} entered
      </div>
      <div className="pref-lists">
        {lists.map((list, i) => (
          <PreferenceListCard key={list.id} contest={contest} list={list} schoolIndex={i} onChange={onChange} />
        ))}
      </div>

      <div className="section-divider">Call list</div>
      {callList.length === 0 ? (
        <p className="muted">Judges appear here once a list has a name.</p>
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
    </Section>
  );
}

function PreferenceListCard({
  contest,
  list,
  schoolIndex,
  onChange,
}: {
  contest: Contest;
  list: PreferenceList;
  schoolIndex: number;
  onChange: (next: Contest) => void;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    if (!draft.trim()) return;
    onChange(addRankedJudge(contest, schoolIndex, draft));
    setDraft('');
  }

  return (
    <div className="pref-list">
      <div className="school-label">{list.label}</div>
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
                  onClick={() => onChange(moveRankedJudge(contest, schoolIndex, i, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="roster-btn"
                  title="Move down"
                  aria-label={`Move ${name} down`}
                  disabled={i === list.ranked.length - 1}
                  onClick={() => onChange(moveRankedJudge(contest, schoolIndex, i, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="roster-btn roster-btn-remove"
                  title="Remove"
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange(removeRankedJudge(contest, schoolIndex, i))}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="pref-add">
        <input
          type="text"
          value={draft}
          placeholder="Judge name"
          aria-label={`Add a judge to ${list.label}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn-util" disabled={!draft.trim()} onClick={add}>
          + Add
        </button>
      </div>
    </div>
  );
}
