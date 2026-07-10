/**
 * Company-block paste parser — the pure text-in / structured-data-out module for
 * the director-submitted company block (PRD #68, Group E).
 *
 * PURE MODULE. No React, no DOM, no IndexedDB, no fetch — plain string in, plain
 * data out, like its siblings `schedule.ts` / `critique.ts`. A director emails the
 * Contest Manager a block like:
 *
 *   Title and school information
 *   Westlake High School
 *   Title: Our Town
 *   Author: Thornton Wilder
 *   Publisher: Samuel French
 *   Type: Scenes
 *   Setting: Grover's Corners, New Hampshire
 *   Runtime: 38 minutes
 *   Music credits:
 *   "Clair de Lune" by Debussy, performed live
 *   Primary director: Pat Rivera
 *   Director two: Chris Lang
 *   Student teacher: Dana Okafor
 *   Entry information
 *   Cast -- Emily Webb: Jane Smith
 *   Crew -- Stage Manager: Sam Board
 *   Alternates
 *   1. Jo Backup
 *   2. Lee Standby
 *
 * …and this turns it into `{ metadata, directors, roster }` that the UI (E3) maps
 * onto the contest via `importCompany` (E1). The parser is TOLERANT and never
 * guesses: unknown lines are ignored, "[Not provided]" reads as blank, and a
 * director-swapped `name: role` line is imported verbatim for the CM to fix.
 *
 * Line-oriented and forgiving by design:
 *   • Labeled fields (`Label: value`) fill the metadata / director slots. A label
 *     with an EMPTY inline value pulls its value from the following non-label
 *     line(s) (e.g. a `Music credits:` header with the credits on the next lines).
 *   • `Cast -- <role>: <name>` / `Crew -- <role>: <name>` become roster members
 *     (left of the colon = role, right = name); a numbered `Alternates` list
 *     becomes `alternate` members (blank role).
 *   • Structural headers (`Title and school information`, `Company: …`, `Entry
 *     information`) and the leading school-name line are ignored — the CM already
 *     chose which school to paste into, so the block's own school name is unused.
 */

import type { ProductionType, RosterMember } from './contest';

/** The labeled production metadata lifted from the block (parser-native names). */
export interface CompanyBlockMetadata {
  title: string;
  author: string;
  publisher: string;
  /** '' when Type was absent or unrecognized; 'play' / 'scenes' otherwise. */
  type: ProductionType;
  setting: string;
  runtime: string;
  music: string;
}

/** The structured result of parsing one director-submitted company block. */
export interface ParsedCompanyBlock {
  metadata: CompanyBlockMetadata;
  /** Director NAMES in order (Primary→four, then a present Student teacher). */
  directors: string[];
  roster: RosterMember[];
}

/** Blank value some directors type into a field they're leaving empty; reads as ''. */
const NOT_PROVIDED = /^\[?\s*not\s+provided\s*\]?$/i;

/** Normalizes a field value: trims and folds "[Not provided]" (and bare "N/A") to ''. */
function cleanValue(raw: string): string {
  const v = raw.trim();
  if (v === '' || NOT_PROVIDED.test(v) || /^n\/?a$/i.test(v)) return '';
  return v;
}

/** Structural headers to skip outright (the leading school-name line falls through the ignore path). */
const STRUCTURAL = [
  /^title and school information\b/i,
  /^entry information\b/i,
  /^company\b/i,
  /^cast and crew\b/i,
  /^production information\b/i,
];

/** A `Cast -- …` / `Crew -- …` roster line (any dash run, any spacing). */
const ROSTER_LINE = /^(cast|crew)\s*[-–—]{1,2}\s*(.*)$/i;

/** A numbered alternate line: `1. Name`, `2) Name`, `3 - Name`. */
const ALTERNATE_LINE = /^\d+\s*[.):\-]\s*(.+)$/;

/** The `Alternates` section header (with or without a trailing colon / content). */
const ALTERNATES_HEADER = /^alternates\b\s*:?\s*$/i;

/** A `Label: value` line — captures the label (letters/spaces) and the inline value. */
const LABEL_LINE = /^([A-Za-z][A-Za-z0-9 '/]*?)\s*:\s*(.*)$/;

/**
 * Which metadata / director slot a normalized label writes to. Keys are the label
 * text lowercased with collapsed internal whitespace. The director slots are held
 * separately and assembled in canonical order at the end.
 */
type Slot =
  | { kind: 'meta'; field: keyof Omit<CompanyBlockMetadata, 'type'> }
  | { kind: 'type' }
  | { kind: 'director'; order: number }
  | { kind: 'studentTeacher' };

const LABELS: Record<string, Slot> = {
  title: { kind: 'meta', field: 'title' },
  show: { kind: 'meta', field: 'title' },
  'show title': { kind: 'meta', field: 'title' },
  author: { kind: 'meta', field: 'author' },
  playwright: { kind: 'meta', field: 'author' },
  publisher: { kind: 'meta', field: 'publisher' },
  type: { kind: 'type' },
  setting: { kind: 'meta', field: 'setting' },
  runtime: { kind: 'meta', field: 'runtime' },
  'running time': { kind: 'meta', field: 'runtime' },
  'music credits': { kind: 'meta', field: 'music' },
  music: { kind: 'meta', field: 'music' },
  'primary director': { kind: 'director', order: 0 },
  'director one': { kind: 'director', order: 0 },
  'director two': { kind: 'director', order: 1 },
  'director three': { kind: 'director', order: 2 },
  'director four': { kind: 'director', order: 3 },
  'student teacher': { kind: 'studentTeacher' },
};

/** Maps a Type value to the model's ProductionType — substring match, tolerant of phrasing. */
function parseType(value: string): ProductionType {
  const v = value.toLowerCase();
  if (v.includes('scene')) return 'scenes';
  if (v.includes('play')) return 'play';
  return '';
}

/** Splits a roster line's remainder into `role : name` (left = role). No colon ⇒ blank role, all name. */
function splitRosterMember(remainder: string, category: 'cast' | 'crew'): RosterMember | null {
  const colon = remainder.indexOf(':');
  const role = colon >= 0 ? cleanValue(remainder.slice(0, colon)) : '';
  const name = colon >= 0 ? cleanValue(remainder.slice(colon + 1)) : cleanValue(remainder);
  if (role === '' && name === '') return null; // e.g. "Cast -- [Not provided]"
  return { name, role, category };
}

/**
 * Parses a director-submitted company block into structured metadata, director
 * names, and a cast/crew/alternate roster. Pure and total: any input yields a
 * well-formed result (blank fields for anything absent), so it can be unit-tested
 * in isolation and never throws on messy paste.
 */
export function parseCompanyBlock(text: string): ParsedCompanyBlock {
  const metadata: CompanyBlockMetadata = {
    title: '',
    author: '',
    publisher: '',
    type: '',
    setting: '',
    runtime: '',
    music: '',
  };
  const directorSlots: string[] = ['', '', '', ''];
  let studentTeacher = '';
  const roster: RosterMember[] = [];

  // A metadata field awaiting continuation lines (its label had an empty inline
  // value). Only text metadata fields take continuations — a director name never
  // spans lines. Cleared by the next label, roster line, section header, or blank.
  let pending: keyof Omit<CompanyBlockMetadata, 'type'> | null = null;
  let inAlternates = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === '') {
      pending = null;
      continue;
    }

    // A recognized roster line always ends any pending value and alternates mode.
    const rosterMatch = line.match(ROSTER_LINE);
    if (rosterMatch) {
      pending = null;
      inAlternates = false;
      const member = splitRosterMember(rosterMatch[2], rosterMatch[1].toLowerCase() as 'cast' | 'crew');
      if (member) roster.push(member);
      continue;
    }

    if (ALTERNATES_HEADER.test(line)) {
      pending = null;
      inAlternates = true;
      continue;
    }

    if (inAlternates) {
      const altMatch = line.match(ALTERNATE_LINE);
      if (altMatch) {
        const name = cleanValue(altMatch[1]);
        if (name !== '') roster.push({ name, role: '', category: 'alternate' });
        continue;
      }
      // A non-numbered line ends the alternates list; fall through to reprocess it.
      inAlternates = false;
    }

    if (STRUCTURAL.some((re) => re.test(line))) {
      pending = null;
      continue;
    }

    const labelMatch = line.match(LABEL_LINE);
    if (labelMatch) {
      const key = labelMatch[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const slot = LABELS[key];
      if (slot) {
        const value = cleanValue(labelMatch[2]);
        pending = null;
        if (slot.kind === 'type') {
          metadata.type = parseType(value);
        } else if (slot.kind === 'director') {
          directorSlots[slot.order] = value;
        } else if (slot.kind === 'studentTeacher') {
          studentTeacher = value;
        } else {
          metadata[slot.field] = value;
          // An empty inline value means the value is on the following line(s).
          if (value === '') pending = slot.field;
        }
        continue;
      }
      // An unknown `Something: …` line is structural noise (e.g. "Company: X").
      pending = null;
      continue;
    }

    // Not a label, roster, header, or alternate: a continuation of a pending
    // metadata value, or otherwise ignorable noise (the leading school-name line).
    if (pending) {
      const addition = cleanValue(line);
      if (addition !== '') {
        metadata[pending] = metadata[pending] === '' ? addition : `${metadata[pending]}\n${addition}`;
      }
    }
  }

  const directors = [...directorSlots, studentTeacher].filter((n) => n !== '');
  return { metadata, directors, roster };
}
