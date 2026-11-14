import { useState } from 'react';
import { MAX_SCHOOLS, type Contest } from '../../model/contest';
import { canFillDistrictSchools, districtSchools, withDistrictSchools } from '../../model/uilAlignment';
import { UIL_ALIGNMENT_SNAPSHOT } from '../../model/uilAlignmentSnapshot';

/**
 * District level only. A district within the school limit is filled in automatically by
 * the identity edit (withAlignmentFill), so this just says where the names came from. A
 * larger district can't be, so the CM ticks the competing schools here.
 */
export function DistrictSchoolsControl({ contest, onChange }: { contest: Contest; onChange: (next: Contest) => void }) {
  const { contestLevel, classification, district } = contest.identity;
  const schools = contestLevel === 'District' ? districtSchools(UIL_ALIGNMENT_SNAPSHOT, classification, district) : null;
  if (!schools) return null;
  const label = `${classification} District ${district.trim()}`;
  const source = `UIL's ${UIL_ALIGNMENT_SNAPSHOT.schoolYear} alignment`;

  if (schools.length <= MAX_SCHOOLS) {
    const filled = contest.schools.length >= schools.length && schools.every((name, i) => contest.schools[i].name === name);
    return filled ? (
      <p className="hint">
        Schools filled in from {source} for {label}. Edit or remove any that aren't competing.
      </p>
    ) : null;
  }
  if (!canFillDistrictSchools(contest, null)) return null;
  return <DistrictSchoolPicker key={label} schools={schools} label={label} source={source} contest={contest} onChange={onChange} />;
}

function DistrictSchoolPicker({
  schools,
  label,
  source,
  contest,
  onChange,
}: {
  schools: readonly string[];
  label: string;
  source: string;
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const full = picked.length >= MAX_SCHOOLS;
  const toggle = (name: string) =>
    setPicked((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));

  return (
    <div className="note-box">
      <p>
        {source} lists {schools.length} schools in {label}, more than the {MAX_SCHOOLS} a contest can hold. Tick
        the schools that are competing to fill in the school list.
      </p>
      <div className="results-check-grid">
        {schools.map((name) => {
          const checked = picked.includes(name);
          return (
            <label key={name} className="results-check">
              <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(name)} />{' '}
              {name}
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={picked.length === 0}
        onClick={() => onChange(withDistrictSchools(contest, schools.filter((n) => picked.includes(n))))}
      >
        Fill in {picked.length} {picked.length === 1 ? 'school' : 'schools'}
      </button>
    </div>
  );
}
