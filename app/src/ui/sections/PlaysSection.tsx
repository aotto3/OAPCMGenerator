import {
  MAX_SCHOOLS,
  withSchool,
  type Contest,
  type SectionCompletion,
} from '../../model/contest';
import { Section } from './Section';
import { TextField } from './fields';

export function PlaysSection({
  contest,
  completion,
  onChange,
}: {
  contest: Contest;
  completion: SectionCompletion;
  onChange: (next: Contest) => void;
}) {
  return (
    <Section
      title="🎭 Play Titles & Performance Order"
      badge="After Entry Deadline"
      completion={completion}
      defaultOpen={false}
    >
      <p className="note-box">
        Enter after the UIL Spring Meet entry deadline. Performance order should match the blind
        draw.
      </p>
      {contest.schools.map((school, i) => (
        <div key={i} className="play-block">
          {/* Live school label — updates as names are typed in the Schools section (v12). */}
          <div className="school-label">
            School {i + 1}
            {school.name ? `: ${school.name}` : ''}
          </div>
          <div className="field-grid">
            <label className="field">
              Performance Order
              <input
                type="number"
                min={1}
                max={MAX_SCHOOLS}
                value={school.performanceOrder}
                onChange={(e) => {
                  const order = parseInt(e.target.value, 10);
                  // Blank/invalid falls back to the school's position, as v12 did.
                  onChange(withSchool(contest, i, { performanceOrder: isNaN(order) ? i + 1 : order }));
                }}
              />
            </label>
            <TextField
              label="Play Title"
              placeholder="Title of Play"
              value={school.playTitle}
              onChange={(v) => onChange(withSchool(contest, i, { playTitle: v }))}
            />
          </div>
        </div>
      ))}
    </Section>
  );
}
