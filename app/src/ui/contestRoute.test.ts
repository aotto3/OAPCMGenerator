import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute, type ContestRoute } from './contestRoute';
import { PANES } from './paneRegistry';

describe('contest route codec', () => {
  it('round-trips the dashboard, a bare contest, and a contest at every pane', () => {
    const routes: ContestRoute[] = [
      { kind: 'dashboard' },
      { kind: 'contest', id: 'abc-123' },
      { kind: 'newContest' },
      { kind: 'newContest', pane: 'judges' },
      ...PANES.map((p): ContestRoute => ({ kind: 'contest', id: 'abc-123', pane: p.id })),
    ];
    for (const route of routes) expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('formats readable paths', () => {
    expect(formatRoute({ kind: 'dashboard' })).toBe('/');
    expect(formatRoute({ kind: 'contest', id: 'abc' })).toBe('/contest/abc');
    expect(formatRoute({ kind: 'contest', id: 'abc', pane: 'schools' })).toBe('/contest/abc/schools');
  });

  it('treats an unknown pane as no pane, so the landing rule applies', () => {
    expect(parseRoute('/contest/abc/bogus')).toEqual({ kind: 'contest', id: 'abc' });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoute('/contest/abc/judges/')).toEqual({ kind: 'contest', id: 'abc', pane: 'judges' });
    expect(parseRoute('/contest/abc/')).toEqual({ kind: 'contest', id: 'abc' });
  });

  it('falls back to the dashboard for anything it does not recognize', () => {
    for (const path of ['', '/', '/contest', '/contest/', '/contest/a/b/c', '/elsewhere', '/q/some-token', '/contest/%E0%A4%A']) {
      expect(parseRoute(path)).toEqual({ kind: 'dashboard' });
    }
  });

  it('encodes ids that need escaping', () => {
    const route: ContestRoute = { kind: 'contest', id: 'a b/c', pane: 'setup' };
    expect(formatRoute(route)).toBe('/contest/a%20b%2Fc/setup');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });
});

describe('the new-contest draft route (#310)', () => {
  it('parses /contest/new with and without a pane', () => {
    expect(parseRoute('/contest/new')).toEqual({ kind: 'newContest' });
    expect(parseRoute('/contest/new/setup')).toEqual({ kind: 'newContest', pane: 'setup' });
    expect(parseRoute('/contest/new/bogus')).toEqual({ kind: 'newContest' });
  });

  it('formats it back', () => {
    expect(formatRoute({ kind: 'newContest' })).toBe('/contest/new');
    expect(formatRoute({ kind: 'newContest', pane: 'setup' })).toBe('/contest/new/setup');
  });
});
