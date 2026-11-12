import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createContest,
  setNumSchools,
  setTabulationRank,
  withAdjudicator,
  withCmInfo,
  withDetails,
  withIdentity,
  withSchool,
  type Contest,
  type ContestIdentity,
} from './contest';
import { tabulationHeader, tabulationHeaderLines, tabulationPrintHtml, tabulationReport } from './tabulationReport';

const NOW = '2026-11-12T12:00:00.000Z';

/** The user's UIL sample: 6A Zone, District 22 Zone A, three schools, judges John Doe / Karen Hager / Smith Wesley. */
function sample(): Contest {
  let c = createContest({
    id: 'c1',
    now: NOW,
    identity: { contestLevel: 'Zone', classification: '6A', district: '22', zone: 'A', hostVenueName: 'Test High School' },
  });
  c = withDetails(c, { numJudges: 3, contestDate: '2026-11-12' }, NOW);
  c = withCmInfo(c, { name: 'Allen Otto' }, NOW);
  c = setNumSchools(c, 3, NOW);
  ['School 1', 'School 2', 'School 3'].forEach((name, i) => {
    c = withSchool(c, i, { name, playTitle: 'Play Name', performanceOrder: i + 1 }, NOW);
  });
  ['John Doe', 'Karen Hager', 'Smith Wesley'].forEach((name, j) => (c = withAdjudicator(c, j, { name }, NOW)));
  const ranks = [
    ['2', '3', '1'],
    ['3', '1', '3'],
    ['1', '2', '2'],
  ];
  ranks.forEach((r, i) => r.forEach((text, j) => (c = setTabulationRank(c, i, j, text, NOW))));
  return c;
}

function headerFor(identity: Partial<ContestIdentity>) {
  return tabulationHeaderLines(tabulationHeader(withIdentity(sample(), identity, NOW)));
}

describe('tabulation header (UIL field mapping)', () => {
  it('maps date, conference, venue, level and CM name', () => {
    expect(tabulationHeader(sample())).toEqual({
      date: '2026-11-12',
      conference: '6A',
      site: 'Test High School',
      level: 'Zone',
      district1: '22',
      zone: 'A',
      manager: 'Allen Otto',
    });
  });

  const levels: [Partial<ContestIdentity>, [string, string][]][] = [
    [
      { contestLevel: 'Zone', district: '22', zone: 'A' },
      [
        ['Contest Level', 'Zone'],
        ['District Number', '22'],
        ['Zone Number', 'A'],
      ],
    ],
    [{ contestLevel: 'District', district: '20' }, [['Contest Level', 'District'], ['District Number', '20']]],
    [
      { contestLevel: 'BiDistrict', district: '19', districtSecond: '20' },
      [
        ['Contest Level', 'Bi-District'],
        ['District Number', '19'],
        ['District Number 2', '20'],
      ],
    ],
    [
      { contestLevel: 'Area', area: '5', region: '3' },
      [
        ['Contest Level', 'Area'],
        ['Area', '5'],
        ['Region', '3'],
      ],
    ],
    [{ contestLevel: 'Region', region: '2' }, [['Contest Level', 'Regional'], ['Region', '2']]],
  ];
  for (const [identity, expected] of levels) {
    it(`prints UIL's lines for ${identity.contestLevel}`, () => {
      const lines = headerFor(identity).map((l) => [l.label, l.value]);
      expect(lines).toEqual([
        ['Date', '2026-11-12'],
        ['Conference', '6A'],
        ['Contest Site', 'Test High School'],
        ...expected,
        ['Contest Manager', 'Allen Otto'],
      ]);
    });
  }

  it("leaves out a level's line when its number is blank, as UIL's template does", () => {
    const labels = headerFor({ contestLevel: 'Zone', district: '22', zone: '' }).map((l) => l.label);
    expect(labels).toContain('District Number');
    expect(labels).not.toContain('Zone Number');
  });
});

describe('tabulationReport', () => {
  it('is null until every ballot is valid', () => {
    expect(tabulationReport(setTabulationRank(sample(), 0, 0, '', NOW))).toBeNull();
  });

  it('is null for a panel that is not 3 judges', () => {
    expect(tabulationReport(withDetails(sample(), { numJudges: 1 }, NOW))).toBeNull();
  });
});

describe('UIL print page', () => {
  const EXPECTED = `<html>
<head>
<title>UIL One-Act Play Panel Tabulation</title>

<style>
h3 {
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
}
</style>
</head>
<body class="l-box">
<div class="results">
<h1>UIL One-Act Play Panel Tabulation</h1>
<h2>Date: 2026-11-12</h2>
<h2>Conference: 6A</h2>
<h2>Contest Site: Test High School</h2>
<h2>Contest Level: Zone</h2>
<h2>District Number: 22</h2>
<h2>Zone Number: A</h2>
<h2>Contest Manager: Allen Otto</h2>
<h3>Results</h3>
<table class="pure-table">
<thead>
<tr>
<th></th>
<th>Place</th>
<th>John Doe</th>
<th>Karen Hager</th>
<th>Smith Wesley</th>
<th>Diagnostic</th>
</tr>
</thead>
<tbody>
<tr>
<td>School 3 - Play Name</td>
<td>1</td>
<td>1</td>
<td>2</td>
<td>2</td>
<td title="1P-0T-S">Lowest Total</td>
</tr>
<tr>
<td>School 1 - Play Name</td>
<td>2</td>
<td>2</td>
<td>3</td>
<td>1</td>
<td title="2P-0T-M">Majority of or better</td>
</tr>
<tr>
<td>School 2 - Play Name</td>
<td>3</td>
<td>3</td>
<td>1</td>
<td>3</td>
<td title="3P-0T-M">Majority of or better</td>
</tr>
</tbody>
</table>
</div>

<div style="text-align: center">
<button class="print-button" onclick='window.print();'>Print</button>
<h2>Email Tabulation the State Theatre Director at <a href="mailto:prodriguez@uiltexas.org">prodriguez@uiltexas.org</a> immediately.</h2>
</div>
<div class="footer">
<p class="smaller">The system of tie-breaking is based on the Constitution and Contest Rules of the the University Interscholastic League and their property</p>
<p>&copy; 2021, Texas Theatre Adjudicators and Officials TTAO</p>
</div>
</body>
</html>
`;

  it("renders UIL's results template for the sample", () => {
    expect(tabulationPrintHtml(tabulationReport(sample())!)).toBe(EXPECTED);
  });

  it('marks a tie broken by the Acting Judge with " - TIE"', () => {
    let c = sample();
    // Cyclic ballot: everything ties, the Acting Judge decides.
    [
      ['1', '2', '3'],
      ['2', '3', '1'],
      ['3', '1', '2'],
    ].forEach((r, i) => r.forEach((t, j) => (c = setTabulationRank(c, i, j, t, NOW))));
    const html = tabulationPrintHtml(tabulationReport(c)!);
    expect(html).toContain('<td>School 1 - Play Name<span class="tie"> - TIE</span></td>');
  });

  it('escapes names the way UIL (Mustache) does', () => {
    const c = withSchool(sample(), 0, { name: 'A&M <Consolidated>' }, NOW);
    const html = tabulationPrintHtml(tabulationReport(c)!);
    expect(html).toContain('<td>A&#x26;M &#x3C;Consolidated&#x3E; - Play Name</td>');
  });

  it("inlines UIL's bundled stylesheets so the page prints offline", () => {
    const css = ['theater-tab-yui.css', 'theater-tab-yui-responsive.css'].map((f) =>
      readFileSync(fileURLToPath(new URL(`../documents/assets/uil/${f}`, import.meta.url)), 'utf8'),
    );
    const html = tabulationPrintHtml(tabulationReport(sample())!, css);
    expect(html).toContain('.pure-table{border-collapse:collapse');
    expect(html).not.toMatch(/<link|https?:\/\/(?!github\.com|git\.io)/);
  });
});
