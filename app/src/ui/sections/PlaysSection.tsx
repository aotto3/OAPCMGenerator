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
  defaultOpen,
}: {
  contest: Contest;
  completion: SectionCompletion;
  onChange: (next: Contest) => void;
  defaultOpen?: boolean;
}) {
  // While the blind draw is locked, its order is authoritative — the manual
  // Performance Order inputs are disabled here and can only be changed by
  // unlocking in the Performance Order Draw section (PRD #65, story 9).
  const drawLocked = contest.draw?.locked ?? false;
  return (
    <Section
      title="🎭 Play Titles & Performance Order"
      badge="After Entry Deadline"
      completion={completion}
      defaultOpen={defaultOpen}
    >
      <p className="note-box">
        Enter after the UIL Spring Meet entry deadline. Performance order should match the blind
        draw.
      </p>
      {drawLocked && (
        <p className="note-box draw-lock-note">
          🔒 Performance order is locked by the blind draw. Unlock it in the{' '}
          <strong>🎟️ Performance Order Draw</strong> section to edit these numbers by hand.
        </p>
      )}
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
                disabled={drawLocked}
                title={drawLocked ? 'Locked by the blind draw — unlock in the Performance Order Draw section' : undefined}
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
