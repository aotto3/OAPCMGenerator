import { useState } from 'react';
import {
  ROSTER_CATEGORIES,
  PRODUCTION_TYPES,
  addRosterMember,
  companyCounts,
  importCompany,
  moveRosterMember,
  removeRosterMember,
  updateRosterMember,
  withSchool,
  type Contest,
  type ParsedCompany,
  type ProductionType,
  type RosterCategory,
} from '../../model/contest';
import { parseCompanyBlock } from '../../model/parseCompanyBlock';
import { Section } from './Section';
import { TextField } from './fields';

/**
 * Companies workspace section (PRD #68, Group E). One card per school (form
 * order): a paste box that runs E2's parseCompanyBlock → E1's importCompany, the
 * editable cast/crew/alternate roster, the production-metadata inputs, and the
 * informational 20/4/24 counter.
 *
 * Additive and optional (user story 31): defaults collapsed, reads/writes only
 * through the pure model updaters, so autosave/sync/export carry it with no
 * plumbing of its own. The play title stays canonical in the Plays section — the
 * paste writes there via importCompany; this section only mirrors it read-only.
 * UI is untested by convention; the parser and model seams are tested in E1/E2.
 */

const TYPE_OPTIONS: ProductionType[] = ['', ...PRODUCTION_TYPES];
const TYPE_LABELS: Record<ProductionType, string> = {
  '': '— Not specified —',
  play: 'Full Play',
  scenes: 'Scenes',
};

const CATEGORY_LABELS: Record<RosterCategory, string> = {
  cast: 'Cast',
  crew: 'Crew',
  alternate: 'Alternate',
};

export function CompaniesSection({
  contest,
  onChange,
}: {
  contest: Contest;
  onChange: (next: Contest) => void;
}) {
  return (
    <Section title="👥 Companies" badge="Optional" defaultOpen={false}>
      <p className="note-box">
        Capture each company once — ideally by <strong>pasting the block a director emailed you</strong>{' '}
        (title, author, type, directors, cast &amp; crew, alternates) — and it flows into the{' '}
        <strong>Audience Program</strong> document. Everything the paste fills stays editable, and the
        20/4 counter is just a heads-up — it never blocks you.
      </p>
      {contest.schools.map((_school, i) => (
        <CompanyCard key={i} contest={contest} schoolIndex={i} onChange={onChange} />
      ))}
    </Section>
  );
}

function CompanyCard({
  contest,
  schoolIndex,
  onChange,
}: {
  contest: Contest;
  schoolIndex: number;
  onChange: (next: Contest) => void;
}) {
  const [paste, setPaste] = useState('');
  const school = contest.schools[schoolIndex];
  const counts = companyCounts(school);

  function handleImport() {
    const text = paste.trim();
    if (!text) return;
    const block = parseCompanyBlock(text);
    // Bridge the parser's native shape to importCompany's ParsedCompany.
    const parsed: ParsedCompany = {
      playTitle: block.metadata.title,
      metadata: {
        author: block.metadata.author,
        publisher: block.metadata.publisher,
        productionType: block.metadata.type,
        setting: block.metadata.setting,
        runtime: block.metadata.runtime,
        musicCredits: block.metadata.music,
      },
      directorNames: block.directors,
      roster: block.roster,
    };
    onChange(importCompany(contest, schoolIndex, parsed));
    setPaste('');
  }

  function addMember(category: RosterCategory) {
    onChange(addRosterMember(contest, schoolIndex, { name: '', role: '', category }));
  }

  return (
    <div className="company-block">
      <div className="school-label">
        School {schoolIndex + 1}
        {school.name ? `: ${school.name}` : ''}
      </div>

      {/* Paste-to-import. */}
      <div className="company-paste">
        <textarea
          value={paste}
          placeholder={
            'Paste the director-submitted company block here…\n\nTitle: …\nAuthor: …\nType: Scenes\nPrimary director: …\nCast -- Role: Name\nCrew -- Position: Name\nAlternates\n1. …'
          }
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
        />
        <div className="company-paste-actions">
          <button type="button" className="btn-util" disabled={!paste.trim()} onClick={handleImport}>
            Parse &amp; import
          </button>
          {paste.trim() && (
            <button type="button" className="btn-ghost" onClick={() => setPaste('')}>
              Clear
            </button>
          )}
        </div>
        <span className="hint">
          Fills the metadata, roster, directors, and play title below — all editable afterward.
        </span>
      </div>

      {/* Production metadata (play title stays canonical in the Plays section). */}
      <div className="section-divider">Production information</div>
      <div className="field-grid">
        <TextField
          label="Play Title"
          value={school.playTitle}
          readOnly
          hint="Edit in 🎭 Play Titles & Order"
        />
        <TextField
          label="Author"
          placeholder="Playwright"
          value={school.author}
          onChange={(v) => onChange(withSchool(contest, schoolIndex, { author: v }))}
        />
        <TextField
          label="Publisher"
          placeholder="Publisher"
          value={school.publisher}
          onChange={(v) => onChange(withSchool(contest, schoolIndex, { publisher: v }))}
        />
        <label className="field">
          Type
          <select
            value={school.productionType}
            onChange={(e) =>
              onChange(withSchool(contest, schoolIndex, { productionType: e.target.value as ProductionType }))
            }
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t || 'none'} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label="Setting"
          placeholder="e.g. A small town, 1901"
          value={school.setting}
          onChange={(v) => onChange(withSchool(contest, schoolIndex, { setting: v }))}
        />
        <TextField
          label="Runtime"
          placeholder="e.g. 38 minutes"
          value={school.runtime}
          onChange={(v) => onChange(withSchool(contest, schoolIndex, { runtime: v }))}
        />
        <TextField
          label="Music credits"
          placeholder="Music / other credits"
          value={school.musicCredits}
          wide
          onChange={(v) => onChange(withSchool(contest, schoolIndex, { musicCredits: v }))}
        />
      </div>

      {/* Roster editor. */}
      <div className="section-divider">Cast, crew &amp; alternates</div>
      {school.roster.length === 0 ? (
        <p className="muted company-empty">No company members yet — paste a block above or add rows below.</p>
      ) : (
        <div className="roster-editor">
          {school.roster.map((member, mi) => {
            const isAlternate = member.category === 'alternate';
            const who = member.name.trim() || `Member ${mi + 1}`;
            return (
              <div className="roster-row" key={mi}>
                <select
                  aria-label={`${who} — category`}
                  value={member.category}
                  onChange={(e) => {
                    const category = e.target.value as RosterCategory;
                    // Alternates are role-less — clear the role when switching to one.
                    const patch = category === 'alternate' ? { category, role: '' } : { category };
                    onChange(updateRosterMember(contest, schoolIndex, mi, patch));
                  }}
                >
                  {ROSTER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label={`${who} — role`}
                  placeholder={isAlternate ? '—' : 'Character / position'}
                  value={member.role}
                  disabled={isAlternate}
                  onChange={(e) => onChange(updateRosterMember(contest, schoolIndex, mi, { role: e.target.value }))}
                />
                <input
                  type="text"
                  aria-label={`${who} — name`}
                  placeholder="Student name"
                  value={member.name}
                  onChange={(e) => onChange(updateRosterMember(contest, schoolIndex, mi, { name: e.target.value }))}
                />
                <div className="roster-row-controls">
                  <button
                    type="button"
                    className="roster-btn"
                    title="Move up"
                    aria-label={`Move ${who} up`}
                    disabled={mi === 0}
                    onClick={() => onChange(moveRosterMember(contest, schoolIndex, mi, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="roster-btn"
                    title="Move down"
                    aria-label={`Move ${who} down`}
                    disabled={mi === school.roster.length - 1}
                    onClick={() => onChange(moveRosterMember(contest, schoolIndex, mi, 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="roster-btn roster-btn-remove"
                    title="Remove"
                    aria-label={`Remove ${who}`}
                    onClick={() => onChange(removeRosterMember(contest, schoolIndex, mi))}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="roster-add">
        <span className="muted">Add:</span>
        <button type="button" className="btn-util" onClick={() => addMember('cast')}>
          + Cast
        </button>
        <button type="button" className="btn-util" onClick={() => addMember('crew')}>
          + Crew
        </button>
        <button type="button" className="btn-util" onClick={() => addMember('alternate')}>
          + Alternate
        </button>
      </div>

      {/* Informational counter — never blocks or warns (user story 12). */}
      <div className="company-counter" role="status">
        <span>
          Cast + Crew: <strong>{counts.castCrew}</strong> / 20
        </span>
        <span>
          Alternates: <strong>{counts.alternates}</strong> / 4
        </span>
        <span>
          Company total: <strong>{counts.total}</strong> / 24
        </span>
      </div>
    </div>
  );
}
