/**
 * Refreshes the bundled UIL academic district alignment snapshot. Run by hand, then
 * commit the result and deploy: npm run refresh:alignments
 *
 * The app never calls UIL itself. This script reads the alignments page for the current
 * per-conference PDFs (their filenames change with every revision), pulls each
 * district's school list out of the PDF by text position, and checks the fixed grid
 * (32 districts, four per column, numbered down the columns) before writing anything.
 * Any surprise aborts with the snapshot left as it is.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const PAGE = 'https://www.uiltexas.org/academics/alignments';
const CONFERENCES = ['1A', '2A', '3A', '4A', '5A', '6A'];
const DISTRICTS = 32;
const DISTRICTS_PER_COLUMN = 4;
const OUTPUT = fileURLToPath(new URL('../src/model/uilAlignmentSnapshot.ts', import.meta.url));

const fail = (message) => {
  throw new Error(`${message}; snapshot left as it is.`);
};
const tidy = (text) => text.trim().replace(/\s+/g, ' ');

async function fetchOk(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!response.ok) fail(`${url} answered ${response.status}`);
  return response;
}

/** The newest school year's PDF link per conference. The page lists the newest year first. */
async function currentLinks() {
  const html = await (await fetchOk(PAGE)).text();
  const year = html.match(/(\d{4}-\d{4}) Alignments/)?.[1] ?? fail('No "YYYY-YYYY Alignments" heading on the UIL page');
  const links = {};
  for (const match of html.matchAll(/href="([^"]+\.pdf)"[^>]*>\s*([1-6]A) Academics\s*</g)) {
    const [, href, conference] = match;
    links[conference] ??= new URL(href, PAGE).href.replace(/^http:/, 'https:');
  }
  for (const conference of CONFERENCES) if (!links[conference]) fail(`No ${conference} Academics link on the UIL page`);
  return { year, links };
}

/** One positioned text run. */
function runsOf(items) {
  return items
    .filter((item) => item.str.trim())
    .map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }));
}

/** Joins same-baseline runs left to right, adding a space only where there is a visible gap. */
function joinRuns(runs) {
  const sorted = [...runs].sort((a, b) => a.x - b.x);
  let text = '';
  let end = -Infinity;
  for (const run of sorted) {
    text += (text && run.x - end > 1 ? ' ' : '') + run.text;
    end = run.x + run.width;
  }
  return tidy(text);
}

/** Groups runs into lines by baseline, top of the page first. */
function linesOf(runs) {
  const lines = [];
  for (const run of [...runs].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - run.y) < 1.5);
    if (line) line.runs.push(run);
    else lines.push({ y: run.y, runs: [run] });
  }
  return lines;
}

/** Districts in column order, each a list of school names, read from one conference PDF. */
async function parseConference(bytes, conference) {
  const doc = await getDocument({ data: bytes, verbosity: 0 }).promise;
  if (doc.numPages !== 1) fail(`${conference}: expected one page, got ${doc.numPages}`);
  const runs = runsOf((await (await doc.getPage(1)).getTextContent()).items);

  const label = `CONFERENCE${conference}`;
  if (!linesOf(runs).some((l) => joinRuns(l.runs).replace(/\s/g, '').includes(label))) fail(`${conference}: PDF is not labelled CONFERENCE ${conference}`);

  // A header is the word "District" with its number on the same baseline, just to the right.
  const headers = runs
    .filter((r) => tidy(r.text) === 'District')
    .map((label) => {
      const number = runs.find((r) => /^\d+$/.test(r.text.trim()) && Math.abs(r.y - label.y) < 2 && r.x > label.x);
      if (!number) fail(`${conference}: a District heading has no number`);
      return { district: Number(number.text), x: label.x, y: label.y, parts: [label, number] };
    });

  const columns = [...new Set(headers.map((h) => Math.round(h.x)))].sort((a, b) => a - b);
  if (columns.length !== DISTRICTS / DISTRICTS_PER_COLUMN) fail(`${conference}: expected 8 columns, found ${columns.length}`);
  const columnOf = (x) => {
    let index = -1;
    columns.forEach((cx, i) => {
      if (x + 1 >= cx) index = i;
    });
    return index;
  };

  const headerParts = new Set(headers.flatMap((h) => h.parts));
  const top = Math.max(...headers.map((h) => h.y)) + 2;
  const byColumn = columns.map(() => []);
  for (const run of runs) {
    if (headerParts.has(run) || run.y > top) continue;
    const column = columnOf(run.x);
    if (column >= 0) byColumn[column].push(run);
  }

  const districts = new Map();
  columns.forEach((cx, column) => {
    // Merge runs sharing a baseline into lines, then walk the column top to bottom.
    const lines = linesOf(byColumn[column]);
    const events = [
      ...headers.filter((h) => columnOf(h.x) === column).map((h) => ({ y: h.y, district: h.district })),
      ...lines.map((l) => {
        const left = Math.min(...l.runs.map((r) => r.x));
        return { y: l.y, text: joinRuns(l.runs), indented: left > cx + 2 };
      }),
    ].sort((a, b) => b.y - a.y);

    let current = null;
    for (const event of events) {
      if (event.district !== undefined) {
        const expected = Math.floor((event.district - 1) / DISTRICTS_PER_COLUMN);
        if (expected !== column) fail(`${conference}: District ${event.district} is in column ${column + 1}, not ${expected + 1}`);
        if (districts.has(event.district)) fail(`${conference}: District ${event.district} appears twice`);
        current = [];
        districts.set(event.district, current);
      } else if (!current) {
        fail(`${conference}: "${event.text}" sits above the first District heading in column ${column + 1}`);
      } else if (event.indented && current.length) {
        current[current.length - 1] += ' ' + event.text;
      } else {
        current.push(event.text);
      }
    }
  });

  const out = [];
  for (let d = 1; d <= DISTRICTS; d++) {
    const schools = districts.get(d);
    if (!schools?.length) fail(`${conference}: District ${d} is missing or empty`);
    out.push(schools);
  }
  if (districts.size !== DISTRICTS) fail(`${conference}: expected ${DISTRICTS} districts, found ${districts.size}`);
  return out;
}

const { year, links } = await currentLinks();
const conferences = {};
for (const conference of CONFERENCES) {
  const bytes = new Uint8Array(await (await fetchOk(links[conference])).arrayBuffer());
  conferences[conference] = await parseConference(bytes, conference);
  const counts = conferences[conference].map((s) => s.length);
  console.log(`${conference}: ${counts.reduce((a, b) => a + b, 0)} schools, ${Math.min(...counts)}–${Math.max(...counts)} per district  (${links[conference]})`);
}

const asOf = new Date().toISOString().slice(0, 10);
const body = CONFERENCES.map((conference) => {
  const districts = conferences[conference].map((schools) => `      ${JSON.stringify(schools)},`).join('\n');
  return `    ${JSON.stringify(conference)}: [\n${districts}\n    ],`;
}).join('\n');

writeFileSync(
  OUTPUT,
  `// Generated by scripts/refresh-uil-alignments.mjs. Don't edit by hand.
import type { AlignmentSnapshot } from './uilAlignment';

export const UIL_ALIGNMENT_SNAPSHOT: AlignmentSnapshot = {
  asOf: ${JSON.stringify(asOf)},
  schoolYear: ${JSON.stringify(year)},
  conferences: {
${body}
  },
};
`,
);
console.log(`Wrote ${year} alignments as of ${asOf} to ${OUTPUT}`);
