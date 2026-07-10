/**
 * Audience Program (.docx) — the printed booklet handed to the audience (PRD #68).
 *
 * NEW document (no v12 ancestor): a cover page, an optional bios section (only when
 * an adjudicator or the Contest Manager has a non-empty bio), then one page per
 * competing school in performance order — the company's title/credits and its
 * cast/crew/alternate roster. Every field is optional and blank-safe: a school with
 * no roster and no metadata degrades to a page with just its name, and a contest
 * with no bios simply omits that section.
 *
 * DETERMINISM: nothing here reads the clock. The only date shown is the stored
 * contest date, formatted from its ISO string — so the golden is stable without a
 * ctx. The registry passes an optional ctx.now for API parity with the other
 * builders; this document does not stamp a "today" date, so it is unused.
 *
 * Pure except makeDocx (JSZip). No DOM.
 */

import {
  contestTitleLong,
  schoolsInPerformanceOrder,
  type Contest,
  type RosterCategory,
  type School,
} from '../model/contest';
import { fmtDate } from './format';
import {
  makeDocx,
  ooP,
  ooPEmpty,
  ooPHead,
  ooPLine,
  ooPPageBreak,
} from './ooxml';

/** Cover page: contest title, "Audience Program", and the host/date/time line. */
function coverPage(contest: Contest): string[] {
  const id = contest.identity;
  const d = contest.details;
  const date = fmtDate(d.contestDate);
  const venue = [id.hostVenueName, id.hostSchoolName].filter((s) => s.trim()).join(' • ');
  return [
    ooPEmpty(400),
    ooP(contestTitleLong(id), { bold: true, size: 34, color: '1F4E79', align: 'center', sb: 0, sa: 80 }),
    ooP('Audience Program', { size: 24, color: '555555', align: 'center', sa: 200 }),
    ooPLine('2E75B6'),
    ooPEmpty(160),
    ...(venue ? [ooP(venue, { size: 22, align: 'center', sa: 60 })] : []),
    ...(id.hostAddress.trim() ? [ooP(id.hostAddress, { size: 18, color: '555555', align: 'center', sa: 60 })] : []),
    ...(date ? [ooP(date, { size: 20, align: 'center', sa: 40 })] : []),
    ...(d.firstShowTime.trim()
      ? [ooP('Performances begin at ' + d.firstShowTime, { size: 20, align: 'center', sa: 40 })]
      : []),
  ];
}

/** One bio entry: the person's name (bold) over their bio paragraph. */
function bioEntry(name: string, bio: string): string[] {
  return [
    ooP(name || '[Name]', { size: 22, bold: true, color: '1F4E79', sa: 40 }),
    ooP(bio, { size: 20, sa: 160 }),
  ];
}

/**
 * Bios section — rendered ONLY when at least one active adjudicator or the CM has a
 * non-empty bio. Active adjudicators (details.numJudges) with a bio come first, then
 * the Contest Manager. A judge with a blank bio is skipped, so only real bios print.
 * Returns [] when there is nothing to show, so the caller omits the whole page.
 */
function biosPage(contest: Contest): string[] {
  const active = contest.adjudicators.slice(0, contest.details.numJudges);
  const judgeBios = active.filter((j) => j.bio.trim() !== '');
  const cmHasBio = contest.cmInfo.bio.trim() !== '';
  if (judgeBios.length === 0 && !cmHasBio) return [];

  return [
    ooP('About Our Panel', { bold: true, size: 28, color: '1F4E79', align: 'center', sb: 0, sa: 60 }),
    ooPLine('2E75B6'),
    ooPEmpty(120),
    ...(judgeBios.length ? [ooPHead('Adjudicators')] : []),
    ...judgeBios.flatMap((j) => bioEntry(j.name, j.bio)),
    ...(cmHasBio ? [ooPHead('Contest Manager'), ...bioEntry(contest.cmInfo.name, contest.cmInfo.bio)] : []),
  ];
}

/** "Cast" / "Crew" / "Alternates" heading for a roster group. */
const CATEGORY_HEADING: Record<RosterCategory, string> = {
  cast: 'Cast',
  crew: 'Crew',
  alternate: 'Alternates',
};

/** "Name — Role" (role omitted when blank, e.g. alternates). */
function memberLine(name: string, role: string): string {
  const n = name.trim() || '[Name]';
  return role.trim() ? n + ' — ' + role.trim() : n;
}

/** One roster group (Cast / Crew / Alternates), or [] when the group is empty. */
function rosterGroup(school: School, category: RosterCategory): string[] {
  const members = school.roster.filter((m) => m.category === category);
  if (members.length === 0) return [];
  return [
    ooP(CATEGORY_HEADING[category], { size: 20, bold: true, color: '1F4E79', sb: 120, sa: 40 }),
    ...members.map((m) => ooP(memberLine(m.name, m.role), { size: 20, indent: 360, sa: 20 })),
  ];
}

/**
 * One school's program page. Title line honors the production type — a Scenes show
 * reads "Presents scenes from {title}"; a full play prints the title plain. Cast,
 * crew, then alternates; then the directed-by / setting / running-time / credits /
 * publisher lines, each omitted when blank. `displayName` carries the "School N"
 * fallback computed against the school's form position.
 */
function schoolPage(school: School, displayName: string): string[] {
  const title = school.playTitle.trim();
  const titleLine =
    title === ''
      ? ''
      : school.productionType === 'scenes'
        ? 'Presents scenes from ' + title
        : title;

  const directors = school.directors.map((d) => d.name.trim()).filter(Boolean).join(', ');

  return [
    ooP(displayName, { bold: true, size: 30, color: '1F4E79', align: 'center', sb: 0, sa: 60 }),
    ...(titleLine ? [ooP(titleLine, { size: 24, italic: true, align: 'center', sa: 40 })] : []),
    ...(school.author.trim() ? [ooP('by ' + school.author.trim(), { size: 20, align: 'center', sa: 40 })] : []),
    ...(directors ? [ooP('Directed by ' + directors, { size: 20, align: 'center', sa: 40 })] : []),
    ...(school.setting.trim() ? [ooP('Setting: ' + school.setting.trim(), { size: 20, align: 'center', sa: 40 })] : []),
    ...(school.runtime.trim()
      ? [ooP('Running time: ' + school.runtime.trim(), { size: 20, align: 'center', sa: 40 })]
      : []),
    ooPEmpty(120),
    ...rosterGroup(school, 'cast'),
    ...rosterGroup(school, 'crew'),
    ...rosterGroup(school, 'alternate'),
    ...(school.musicCredits.trim()
      ? [ooPEmpty(120), ooP('Music & Credits: ' + school.musicCredits.trim(), { size: 18, color: '555555', sa: 40 })]
      : []),
    ...(school.publisher.trim()
      ? [ooP('Produced by special arrangement with ' + school.publisher.trim(), { size: 18, color: '555555', sa: 40 })]
      : []),
  ];
}

/**
 * Builds the Audience Program. The registry's `program` entry delegates here. Pages
 * (cover, optional bios, one per school in performance order) are separated by hard
 * page breaks. The "School N" blank-name fallback keys on the ORIGINAL form position
 * (computed before the performance-order sort), matching docSchools/v12.
 */
export async function buildProgram(contest: Contest): Promise<Uint8Array> {
  const formIndex = new Map(contest.schools.map((s, i) => [s, i + 1] as const));
  const pages: string[][] = [coverPage(contest)];

  const bios = biosPage(contest);
  if (bios.length) pages.push(bios);

  for (const school of schoolsInPerformanceOrder(contest)) {
    pages.push(schoolPage(school, school.name.trim() || 'School ' + formIndex.get(school)));
  }

  const body = pages.map((page) => page.filter(Boolean).join('')).join(ooPPageBreak());
  return await makeDocx(body);
}
