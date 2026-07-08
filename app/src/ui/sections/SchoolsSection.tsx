import {
  addDirector,
  removeDirector,
  withDirector,
  withSchool,
  type Contest,
  type SectionCompletion,
} from '../../model/contest';
import { Section } from './Section';
import { TextField } from './fields';

export function SchoolsSection({
  contest,
  completion,
  onChange,
  defaultOpen,
}: {
  contest: Contest;
  completion: SectionCompletion;
  onChange: (next: Contest) => void;
  defaultOpen?: boolean;
}) {
  return (
    <Section title="🏫 Schools & Directors" badge="Enter As Known" completion={completion} defaultOpen={defaultOpen}>
      <p className="note-box">
        Enter school names and director contact info as soon as you know who is participating. Set{' '}
        <strong>Number of Schools</strong> in Contest Details first. Play titles are entered in the
        next section after the entry deadline.
      </p>
      {contest.schools.map((school, i) => (
        <div key={i} className="school-block">
          <h3>School {i + 1}</h3>
          <div className="field-grid">
            <TextField
              label="School Name"
              wide
              placeholder="School Name"
              value={school.name}
              onChange={(v) => onChange(withSchool(contest, i, { name: v }))}
            />
          </div>
          {school.directors.map((director, di) => (
            <div key={di} className="director-row field-grid">
              <TextField
                label={`Director ${di + 1} — Name`}
                placeholder="First Last"
                value={director.name}
                onChange={(v) => onChange(withDirector(contest, i, di, { name: v }))}
              />
              <label className="field">
                Director {di + 1} — Email
                <span className="input-with-button">
                  <input
                    type="email"
                    placeholder="email@district.org"
                    value={director.email}
                    onChange={(e) => onChange(withDirector(contest, i, di, { email: e.target.value }))}
                  />
                  {school.directors.length > 1 && (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => onChange(removeDirector(contest, i, di))}
                    >
                      Remove
                    </button>
                  )}
                </span>
              </label>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => onChange(addDirector(contest, i))}>
            + Add Another Director
          </button>
        </div>
      ))}
    </Section>
  );
}
