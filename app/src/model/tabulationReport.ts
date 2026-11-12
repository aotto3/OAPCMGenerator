/**
 * Panel tabulation report (PRD #236): the header and results that UIL's TTAO
 * Tabulation Tool prints, and the print page itself.
 *
 * PURE MODULE. Contest in, report data or HTML text out. The print page is
 * UIL's results template reproduced as written (wording, the missing "to" in
 * "Email Tabulation the State Theatre Director", the doubled "the the" in the
 * footer), so the CM's printout reads the same as the one UIL's site produces.
 * The two UIL stylesheets are passed in as text by the caller (bundled app
 * assets) and inlined, which keeps printing working offline.
 */

import type { Contest, ContestLevel } from './contest';
import { tabulationView, type TabulationResult } from './tabulation';

/** The State Theatre Director's address, as printed on UIL's results page. */
export const STATE_THEATRE_DIRECTOR_EMAIL = 'prodriguez@uiltexas.org';

/** UIL's words for each level (its Contest Level dropdown). */
const UIL_LEVEL_TEXT: Record<ContestLevel, string> = {
  Zone: 'Zone',
  District: 'District',
  BiDistrict: 'Bi-District',
  Area: 'Area',
  Region: 'Regional',
};

/**
 * The header block. The optional lines are present only for the levels where
 * UIL's form shows that field, and only when filled in (UIL's template skips an
 * empty value).
 */
export interface TabulationHeader {
  /** Contest date as yyyy-mm-dd (UIL's date input format). */
  date: string;
  conference: string;
  site: string;
  level: string;
  district1?: string;
  district2?: string;
  zone?: string;
  area?: string;
  region?: string;
  manager: string;
}

export interface TabulationReport {
  header: TabulationHeader;
  /** Column heads: Acting Judge, Judge B, Judge C names. */
  judgeNames: [string, string, string];
  /** Sorted by place. */
  results: TabulationResult[];
}

/** One header line as UIL prints it, in template order. */
export interface TabulationHeaderLine {
  label: string;
  value: string;
}

export function tabulationHeader(contest: Contest): TabulationHeader {
  const id = contest.identity;
  const header: TabulationHeader = {
    date: contest.details.contestDate.trim(),
    conference: id.classification,
    site: id.hostVenueName.trim(),
    level: UIL_LEVEL_TEXT[id.contestLevel],
    manager: contest.cmInfo.name.trim(),
  };
  const set = (key: 'district1' | 'district2' | 'zone' | 'area' | 'region', value: string) => {
    if (value.trim()) header[key] = value.trim();
  };
  switch (id.contestLevel) {
    case 'Zone':
      set('district1', id.district);
      set('zone', id.zone);
      break;
    case 'BiDistrict':
      set('district1', id.district);
      set('district2', id.districtSecond);
      break;
    case 'District':
      set('district1', id.district);
      break;
    case 'Area':
      set('area', id.area);
      set('region', id.region);
      break;
    case 'Region':
      set('region', id.region);
      break;
  }
  return header;
}

/** The header as printed lines, in UIL's template order. */
export function tabulationHeaderLines(header: TabulationHeader): TabulationHeaderLine[] {
  const lines: TabulationHeaderLine[] = [
    { label: 'Date', value: header.date },
    { label: 'Conference', value: header.conference },
    { label: 'Contest Site', value: header.site },
    { label: 'Contest Level', value: header.level },
  ];
  if (header.district1) lines.push({ label: 'District Number', value: header.district1 });
  if (header.district2) lines.push({ label: 'District Number 2', value: header.district2 });
  if (header.zone) lines.push({ label: 'Zone Number', value: header.zone });
  if (header.area) lines.push({ label: 'Area', value: header.area });
  if (header.region) lines.push({ label: 'Region', value: header.region });
  lines.push({ label: 'Contest Manager', value: header.manager });
  return lines;
}

/** The full report, or null until every ballot is valid (or the panel is not 3 judges). */
export function tabulationReport(contest: Contest): TabulationReport | null {
  const view = tabulationView(contest);
  if (!view.applicable || !view.results) return null;
  return { header: tabulationHeader(contest), judgeNames: view.judgeNames, results: view.results };
}

/** Mustache's {{ }} escaping, as UIL's page renders values. */
function esc(value: string | number): string {
  return String(value).replace(/[&<>"'`=/]/g, (ch) => `&#x${ch.charCodeAt(0).toString(16).toUpperCase()};`);
}

/** UIL's inline style block from the results template. */
const UIL_RESULT_STYLES = `h3 {
  text-align: center;
}
table {
  margin: auto;
}
.print-button {
  margin-top: 1em;
  font-size: 120%;
}
.results {
  padding: 1em;
}
.results h1 {
  font-size: 1.2em;
}
.results h2 {
  font-size: .9em;
}
.results .pure-table {
  font-size: 1em;
}
.footer {
  margin: auto;
  margin-top: 7em;
  width: 100%;
  text-align: center;
}
.smaller {
  font-size: 80%;
}
@media print {
  button {
    display: none;
  }
}`;

/**
 * UIL's results page for a report. `stylesheets` are the texts of UIL's two
 * stylesheets (theater-tab-yui.css, theater-tab-yui-responsive.css), inlined in
 * place of UIL's links so the page needs no network.
 */
export function tabulationPrintHtml(report: TabulationReport, stylesheets: readonly string[] = []): string {
  const h = report.header;
  const headerLines = tabulationHeaderLines(h)
    .map((line) => `<h2>${esc(line.label)}: ${esc(line.value)}</h2>`)
    .join('\n');
  const rows = report.results
    .map((r) =>
      [
        '<tr>',
        `<td>${esc(r.label)}${r.tie ? '<span class="tie"> - TIE</span>' : ''}</td>`,
        `<td>${esc(r.place)}</td>`,
        ...r.ranks.map((rank) => `<td>${esc(rank)}</td>`),
        `<td title="${esc(r.diagnosticCode)}">${esc(r.diagnostic)}</td>`,
        '</tr>',
      ].join('\n'),
    )
    .join('\n');
  const [judgeA, judgeB, judgeC] = report.judgeNames;

  return `<html>
<head>
<title>UIL One-Act Play Panel Tabulation</title>
${stylesheets.map((css) => `<style media="all">\n${css}\n</style>`).join('\n')}
<style>
${UIL_RESULT_STYLES}
</style>
</head>
<body class="l-box">
<div class="results">
<h1>UIL One-Act Play Panel Tabulation</h1>
${headerLines}
<h3>Results</h3>
<table class="pure-table">
<thead>
<tr>
<th></th>
<th>Place</th>
<th>${esc(judgeA)}</th>
<th>${esc(judgeB)}</th>
<th>${esc(judgeC)}</th>
<th>Diagnostic</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</div>

<div style="text-align: center">
<button class="print-button" onclick='window.print();'>Print</button>
<h2>Email Tabulation the State Theatre Director at <a href="mailto:${STATE_THEATRE_DIRECTOR_EMAIL}">${STATE_THEATRE_DIRECTOR_EMAIL}</a> immediately.</h2>
</div>
<div class="footer">
<p class="smaller">The system of tie-breaking is based on the Constitution and Contest Rules of the the University Interscholastic League and their property</p>
<p>&copy; 2021, Texas Theatre Adjudicators and Officials TTAO</p>
</div>
</body>
</html>
`;
}
