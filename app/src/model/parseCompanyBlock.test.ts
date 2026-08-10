import { describe, expect, it } from 'vitest';
import { importCompanyBlock, parseCompanyBlock } from './parseCompanyBlock';
import { createContest, setNumSchools, type RosterMember } from './contest';

/* Three realistic director-submitted blocks exercise the full parser; the focused
 * cases below pin the individual rules. The parser is pure and total — every input
 * yields a well-formed result, so nothing here needs a try/catch. */

const BLOCK_SCENES = `Title and school information
Westlake High School
Company: Westlake HS Theatre Department
Title: Our Town
Author: Thornton Wilder
Publisher: Samuel French
Type: Scenes
Setting: Grover's Corners, New Hampshire
Runtime: 38 minutes
Music credits: "Clair de Lune" by Debussy
Primary director: Pat Rivera
Director two: Chris Lang
Student teacher: Dana Okafor
Entry information
Cast -- Emily Webb: Jane Smith
Cast -- George Gibbs: Alex Ruiz
Crew -- Stage Manager: Sam Board
Crew -- Lighting Designer: Morgan Lee
Alternates
1. Jo Backup
2. Lee Standby`;

const BLOCK_PLAY = `Lincoln High School
Title: Proof
Author: David Auburn
Publisher: [Not provided]
Type: Full Play
Setting: A back porch in Chicago
Runtime:
95 minutes
Music credits:
Original underscore by the school jazz band
Additional cues from public-domain recordings
Primary director: Robin Vance
Director three: Taylor Kim
Cast -- Catherine: Priya Nair
Crew -- Sound: [Not provided]`;

const BLOCK_MESSY = `River Oaks Academy
Title: Antigone
Primary director: Jamie Cross
Cast -- Alex Chen: Antigone
Cast -- Creon: Sam Diaz
Crew -- Jordan Blake`;

describe('parseCompanyBlock — full director blocks', () => {
  it('parses a complete Scenes block (metadata, directors incl. student teacher, cast/crew/alternates)', () => {
    const { metadata, directors, roster } = parseCompanyBlock(BLOCK_SCENES);
    expect(metadata).toEqual({
      title: 'Our Town',
      author: 'Thornton Wilder',
      publisher: 'Samuel French',
      type: 'scenes',
      setting: "Grover's Corners, New Hampshire",
      runtime: '38 minutes',
      music: '"Clair de Lune" by Debussy',
    });
    expect(directors).toEqual(['Pat Rivera', 'Chris Lang', 'Dana Okafor']); // student teacher folded in last
    expect(roster).toEqual<RosterMember[]>([
      { name: 'Jane Smith', role: 'Emily Webb', category: 'cast' },
      { name: 'Alex Ruiz', role: 'George Gibbs', category: 'cast' },
      { name: 'Sam Board', role: 'Stage Manager', category: 'crew' },
      { name: 'Morgan Lee', role: 'Lighting Designer', category: 'crew' },
      { name: 'Jo Backup', role: '', category: 'alternate' },
      { name: 'Lee Standby', role: '', category: 'alternate' },
    ]);
  });

  it('parses a Play block: multiline music, value-on-next-line runtime, [Not provided] folds to blank, gapped directors', () => {
    const { metadata, directors, roster } = parseCompanyBlock(BLOCK_PLAY);
    expect(metadata.title).toBe('Proof');
    expect(metadata.type).toBe('play'); // "Full Play" → play
    expect(metadata.publisher).toBe(''); // [Not provided] → blank
    expect(metadata.runtime).toBe('95 minutes'); // "Runtime:" empty, value on next line
    expect(metadata.music).toBe(
      'Original underscore by the school jazz band\nAdditional cues from public-domain recordings',
    );
    // Primary + Director three filled, Director two skipped → collapses in order.
    expect(directors).toEqual(['Robin Vance', 'Taylor Kim']);
    expect(roster).toEqual<RosterMember[]>([
      { name: 'Priya Nair', role: 'Catherine', category: 'cast' },
      { name: '', role: 'Sound', category: 'crew' }, // position kept, [Not provided] name → blank
    ]);
  });

  it('imports a swapped "name: role" line VERBATIM and handles a no-colon crew line', () => {
    const { metadata, directors, roster } = parseCompanyBlock(BLOCK_MESSY);
    expect(metadata.title).toBe('Antigone');
    expect(metadata.type).toBe(''); // no Type line
    expect(directors).toEqual(['Jamie Cross']);
    expect(roster).toEqual<RosterMember[]>([
      // Director typed "actor: character" — parser does NOT guess; left stays role.
      { name: 'Antigone', role: 'Alex Chen', category: 'cast' },
      { name: 'Sam Diaz', role: 'Creon', category: 'cast' },
      // No colon ⇒ blank role, whole remainder is the name.
      { name: 'Jordan Blake', role: '', category: 'crew' },
    ]);
  });
});

describe('parseCompanyBlock — Type mapping', () => {
  it('maps phrasing variants to play / scenes / blank', () => {
    expect(parseCompanyBlock('Type: Scenes').metadata.type).toBe('scenes');
    expect(parseCompanyBlock('Type: Scenes from a longer work').metadata.type).toBe('scenes');
    expect(parseCompanyBlock('Type: Play').metadata.type).toBe('play');
    expect(parseCompanyBlock('Type: Full-Length Play').metadata.type).toBe('play');
    expect(parseCompanyBlock('Type: One-act').metadata.type).toBe(''); // neither word present
    expect(parseCompanyBlock('Antigone High\nAuthor: X').metadata.type).toBe(''); // no Type line
  });
});

describe('parseCompanyBlock — directors', () => {
  it('collects Primary→four in order and appends a present student teacher', () => {
    const text = `Director four: Four
Primary director: One
Director two: Two
Director three: Three
Student teacher: Teach`;
    // Output order is canonical (Primary→four, then student teacher), not paste order.
    expect(parseCompanyBlock(text).directors).toEqual(['One', 'Two', 'Three', 'Four', 'Teach']);
  });

  it('yields a student teacher alone as the sole director', () => {
    expect(parseCompanyBlock('Student teacher: Only Teacher').directors).toEqual(['Only Teacher']);
  });

  it('accepts "Director one" as a synonym for the primary slot', () => {
    expect(parseCompanyBlock('Director one: Alpha\nDirector two: Beta').directors).toEqual(['Alpha', 'Beta']);
  });

  it('drops [Not provided] director slots', () => {
    const text = 'Primary director: Real Name\nDirector two: [Not provided]';
    expect(parseCompanyBlock(text).directors).toEqual(['Real Name']);
  });
});

describe('parseCompanyBlock — roster edge cases', () => {
  it('skips a "[Not provided]" cast line entirely (both sides blank)', () => {
    expect(parseCompanyBlock('Cast -- [Not provided]').roster).toEqual([]);
  });

  it('accepts em-dash and single-dash separators', () => {
    const em = parseCompanyBlock('Cast — Hamlet: Robin Vale').roster;
    const single = parseCompanyBlock('Crew - Props: Casey Fox').roster;
    expect(em).toEqual<RosterMember[]>([{ name: 'Robin Vale', role: 'Hamlet', category: 'cast' }]);
    expect(single).toEqual<RosterMember[]>([{ name: 'Casey Fox', role: 'Props', category: 'crew' }]);
  });

  it('parses numbered alternates with . ) and - separators; a non-numbered line ends the list', () => {
    const text = `Alternates
1. First Alt
2) Second Alt
3 - Third Alt
Publisher: Dramatists`;
    const parsed = parseCompanyBlock(text);
    expect(parsed.roster).toEqual<RosterMember[]>([
      { name: 'First Alt', role: '', category: 'alternate' },
      { name: 'Second Alt', role: '', category: 'alternate' },
      { name: 'Third Alt', role: '', category: 'alternate' },
    ]);
    // The label after the list is still parsed (alternates mode ended cleanly).
    expect(parsed.metadata.publisher).toBe('Dramatists');
  });

  it('keeps cast, crew, and alternates in encounter order across interleaving', () => {
    const text = `Cast -- Lead: A
Crew -- Tech: B
Alternates
1. C`;
    expect(parseCompanyBlock(text).roster.map((m) => m.category)).toEqual(['cast', 'crew', 'alternate']);
  });
});

describe('parseCompanyBlock — tolerance & structure', () => {
  it('returns all-blank metadata + empty arrays for empty or whitespace input', () => {
    const blank = { title: '', author: '', publisher: '', type: '', setting: '', runtime: '', music: '' };
    expect(parseCompanyBlock('')).toEqual({ metadata: blank, directors: [], roster: [] });
    expect(parseCompanyBlock('   \n\n\t\n')).toEqual({ metadata: blank, directors: [], roster: [] });
  });

  it('ignores structural headers, the leading school-name line, and unknown "Key: value" lines', () => {
    const text = `Title and school information
Springtown High School
Company: Springtown Players
Entry information
Some Random Heading
Sponsor: Local Bank
Title: Real Title`;
    const parsed = parseCompanyBlock(text);
    expect(parsed.metadata.title).toBe('Real Title');
    // None of the noise leaked into metadata/directors/roster.
    expect(parsed.metadata.author).toBe('');
    expect(parsed.directors).toEqual([]);
    expect(parsed.roster).toEqual([]);
  });

  it('leaves a trailing empty-value label blank when no continuation line follows', () => {
    expect(parseCompanyBlock('Title: The Show\nMusic credits:').metadata.music).toBe('');
  });

  it('does not let a blank line bleed one field into the next label’s continuation', () => {
    const text = `Setting:
A quiet town

Runtime:
Author line should not be swallowed`;
    const parsed = parseCompanyBlock(text);
    expect(parsed.metadata.setting).toBe('A quiet town');
    // The blank line closed Setting; Runtime then took its own continuation.
    expect(parsed.metadata.runtime).toBe('Author line should not be swallowed');
  });

  it('is case-insensitive on labels and tolerates extra spacing around the colon', () => {
    const text = 'TITLE :   Spaced Out\nprimary director :  Case Insensitive';
    const parsed = parseCompanyBlock(text);
    expect(parsed.metadata.title).toBe('Spaced Out');
    expect(parsed.directors).toEqual(['Case Insensitive']);
  });

  it('parses CRLF line endings', () => {
    const parsed = parseCompanyBlock('Title: Windows Paste\r\nCast -- Lead: Star\r\n');
    expect(parsed.metadata.title).toBe('Windows Paste');
    expect(parsed.roster).toEqual<RosterMember[]>([{ name: 'Star', role: 'Lead', category: 'cast' }]);
  });
});

const IMPORT_NOW = '2026-07-05T12:00:00.000Z';

/** A fresh contest with `n` blank schools, for exercising importCompanyBlock end-to-end. */
function contestWith(n: number) {
  return setNumSchools(createContest({ id: 'import-test', now: IMPORT_NOW }), n);
}

describe('importCompanyBlock — parse + translate + apply', () => {
  it('maps a full block onto the target school (block vocabulary → storage vocabulary)', () => {
    const s = importCompanyBlock(contestWith(3), 0, BLOCK_SCENES, IMPORT_NOW).schools[0];
    // The rename the view used to do inline, now covered at the model boundary:
    expect(s.playTitle).toBe('Our Town'); // title → playTitle
    expect(s.productionType).toBe('scenes'); // type → productionType
    expect(s.musicCredits).toBe('"Clair de Lune" by Debussy'); // music → musicCredits
    // Straight-through fields:
    expect(s.author).toBe('Thornton Wilder');
    expect(s.publisher).toBe('Samuel French');
    expect(s.setting).toBe("Grover's Corners, New Hampshire");
    expect(s.runtime).toBe('38 minutes');
    expect(s.directors.map((d) => d.name)).toEqual(['Pat Rivera', 'Chris Lang', 'Dana Okafor']);
    expect(s.roster).toEqual<RosterMember[]>([
      { name: 'Jane Smith', role: 'Emily Webb', category: 'cast' },
      { name: 'Alex Ruiz', role: 'George Gibbs', category: 'cast' },
      { name: 'Sam Board', role: 'Stage Manager', category: 'crew' },
      { name: 'Morgan Lee', role: 'Lighting Designer', category: 'crew' },
      { name: 'Jo Backup', role: '', category: 'alternate' },
      { name: 'Lee Standby', role: '', category: 'alternate' },
    ]);
  });

  it('leaves existing directors untouched when the block names none (a partial paste never wipes them)', () => {
    // First paste seeds the directors; a second, director-less paste must keep them.
    const seeded = importCompanyBlock(contestWith(2), 0, BLOCK_SCENES, IMPORT_NOW);
    expect(seeded.schools[0].directors.map((d) => d.name)).toEqual(['Pat Rivera', 'Chris Lang', 'Dana Okafor']);
    const s = importCompanyBlock(seeded, 0, 'Title: Just A Title', IMPORT_NOW).schools[0];
    expect(s.playTitle).toBe('Just A Title');
    expect(s.directors.map((d) => d.name)).toEqual(['Pat Rivera', 'Chris Lang', 'Dana Okafor']);
  });

  it('is a no-op for an out-of-range school index', () => {
    const c = contestWith(2);
    expect(importCompanyBlock(c, 5, BLOCK_SCENES, IMPORT_NOW)).toBe(c);
  });

  it('touches only the target school', () => {
    const c = importCompanyBlock(contestWith(3), 1, BLOCK_SCENES, IMPORT_NOW);
    expect(c.schools[0].playTitle).toBe('');
    expect(c.schools[1].playTitle).toBe('Our Town');
    expect(c.schools[2].playTitle).toBe('');
  });
});
