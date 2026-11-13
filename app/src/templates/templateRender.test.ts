/**
 * The custom template renderer (PRD #320): every value field against the
 * document fixture contest, the blank placeholders, unknown fields, and plain
 * text passing through untouched.
 */
import { describe, expect, it } from 'vitest';
import { fixtureContest } from '../documents/__fixtures__/fixtureContest';
import { createContest, withCmInfo, withDetails, withIdentity } from '../model/contest';
import {
  judgeNeedsEmail,
  judgesEmail,
  QUESTIONNAIRE_LINK_PLACEHOLDER,
} from '../documents/emailTemplates';
import { MERGE_FIELDS, mergeTag, renderTemplate, usesField } from './templateRender';

const body = (text: string) => renderTemplate({ subject: '', body: text }, fixtureContest()).body;

describe('value fields', () => {
  it('fills each field from the contest, formatted like the built-in emails', () => {
    expect(body('{{contestName}}')).toBe('UIL 5A District 20 One-Act Play Contest');
    expect(body('{{contestLevel}}')).toBe('District');
    expect(body('{{contestDate}}')).toBe('Saturday, March 21, 2026');
    expect(body('{{venueName}}')).toBe('Performing Arts Center');
    expect(body('{{venueAddress}}')).toBe('7504 Bissonnet St, Houston, TX 77074');
    expect(body('{{directorsMeetingTime}}')).toBe('9:00 AM');
    expect(body('{{firstShowTime}}')).toBe('10:00 AM');
    expect(body('{{entryDeadline}}')).toBe('March 11, 2026');
    expect(body('{{lightCueDeadline}}')).toBe('March 11, 2026 by 5:00 PM');
    expect(body('{{cmName}}')).toBe('Dana Whitfield');
    expect(body('{{cmEmail}}')).toBe('dana.whitfield@example.org');
    expect(body('{{cmPhone}}')).toBe('555-0142');
    expect(body('{{cmWebsite}}')).toBe('www.example.org');
  });

  it('every catalog field renders and none is reported unknown', () => {
    for (const f of MERGE_FIELDS) {
      const out = renderTemplate({ subject: mergeTag(f.key), body: mergeTag(f.key) }, fixtureContest());
      expect(out.unknownFields).toEqual([]);
      expect(out.body).not.toContain('{{');
    }
  });

  it('fills the subject and the body, every occurrence, spaces inside braces allowed', () => {
    const out = renderTemplate(
      { subject: '{{ contestLevel }} reminder', body: '{{cmName}} / {{cmName}}\nAt {{venueName}}.' },
      fixtureContest(),
    );
    expect(out.subject).toBe('District reminder');
    expect(out.body).toBe('Dana Whitfield / Dana Whitfield\nAt Performing Arts Center.');
  });

  it('a light cue deadline with no time uses the built-in default of 5:00 PM', () => {
    const c = withDetails(fixtureContest(), { lightCueDeadlineTime: '' });
    expect(renderTemplate({ subject: '', body: '{{lightCueDeadline}}' }, c).body).toBe('March 11, 2026 by 5:00 PM');
  });
});

describe('blank contest values', () => {
  const blank = () => {
    let c = createContest({ id: 'blank', now: '2026-07-05T12:00:00.000Z' });
    c = withIdentity(c, { hostVenueName: '', hostAddress: '' });
    c = withCmInfo(c, { name: '', email: '', phone: '', website: '' });
    return withDetails(c, {
      contestDate: '',
      directorsMeetingTime: '',
      firstShowTime: '',
      entrySystemDeadline: '',
      lightCueDeadlineDate: '',
    });
  };
  const render = (text: string) => renderTemplate({ subject: '', body: text }, blank()).body;

  it('required fields show a bracketed placeholder', () => {
    expect(render('{{contestDate}}')).toBe('[Contest Date TBD]');
    expect(render('{{venueName}}')).toBe('[Venue TBD]');
    expect(render('{{venueAddress}}')).toBe('[Address TBD]');
    expect(render('{{directorsMeetingTime}}')).toBe('[Directors’ Meeting Time TBD]');
    expect(render('{{firstShowTime}}')).toBe('[First Show Time TBD]');
    expect(render('{{entryDeadline}}')).toBe('[Entry Deadline TBD]');
    expect(render('{{lightCueDeadline}}')).toBe('[Light Cue Deadline TBD]');
    expect(render('{{cmName}}')).toBe('[CM Name]');
    expect(render('{{cmEmail}}')).toBe('[CM Email]');
  });

  it('optional fields drop out', () => {
    expect(render('Call {{cmPhone}}. Visit {{cmWebsite}}.')).toBe('Call . Visit .');
  });

  it('a whitespace-only value counts as blank', () => {
    const c = withIdentity(fixtureContest(), { hostVenueName: '   ' });
    expect(renderTemplate({ subject: '', body: '{{venueName}}' }, c).body).toBe('[Venue TBD]');
  });
});

describe('unknown fields', () => {
  it('are left as typed and reported once each, subject first', () => {
    const out = renderTemplate(
      { subject: '{{oops}} {{contestLevel}}', body: '{{ venuName }} and {{oops}} and {{venueName}}' },
      fixtureContest(),
    );
    expect(out.subject).toBe('{{oops}} District');
    expect(out.body).toBe('{{ venuName }} and {{oops}} and Performing Arts Center');
    expect(out.unknownFields).toEqual(['oops', 'venuName']);
  });

  it('field names are case-sensitive', () => {
    expect(renderTemplate({ subject: '', body: '{{ContestName}}' }, fixtureContest()).unknownFields).toEqual([
      'ContestName',
    ]);
  });
});

describe('plain text', () => {
  it('passes through unchanged, including single braces and empty braces', () => {
    const text = 'Dear judges,\n\n{ not a field } {{}} {{ two words }}\n\nThanks!';
    const out = renderTemplate({ subject: 'Hello', body: text }, fixtureContest());
    expect(out).toEqual({ subject: 'Hello', body: text, unknownFields: [] });
  });
});

describe('block fields', () => {
  it('the show order matches the Judge Reminder’s list', () => {
    const list = body('{{showOrder}}');
    expect(list.split('\n')[0]).toMatch(/^1\. /);
    expect(judgesEmail(fixtureContest()).body).toContain(list);
  });

  it('the judges’ arrival time is the meeting minus 20 minutes', () => {
    expect(body('{{judgeArrivalTime}}')).toBe('8:40 AM');
  });

  it('an unreadable meeting time gives the built-in’s prose', () => {
    const c = withDetails(fixtureContest(), { directorsMeetingTime: '' });
    expect(renderTemplate({ subject: '', body: '{{judgeArrivalTime}}' }, c).body).toBe(
      '[at least 20 minutes before the Directors’ Meeting]',
    );
  });

  it('the judges’ needs match the Judge Needs email’s list', () => {
    const list = body('{{judgeNeeds}}');
    expect(list).toContain('  • Hotel: ');
    expect(judgeNeedsEmail(fixtureContest()).body.endsWith(list)).toBe(true);
  });

  it('no schools or no judges give a placeholder', () => {
    const c = { ...fixtureContest(), schools: [], adjudicators: [] };
    const out = renderTemplate({ subject: '', body: '{{showOrder}}|{{judgeNeeds}}' }, c);
    expect(out.body).toBe('[Show Order TBD]|[No judges entered yet]');
  });

  it('the questionnaire link comes from the context, else the paste-here placeholder', () => {
    const t = { subject: '', body: 'Fill it out: {{questionnaireLink}}' };
    expect(renderTemplate(t, fixtureContest(), { questionnaireLink: 'https://x.test/q/abc' }).body).toBe(
      'Fill it out: https://x.test/q/abc',
    );
    expect(renderTemplate(t, fixtureContest()).body).toBe('Fill it out: ' + QUESTIONNAIRE_LINK_PLACEHOLDER);
    expect(renderTemplate(t, fixtureContest(), { questionnaireLink: null }).body).toBe(
      'Fill it out: ' + QUESTIONNAIRE_LINK_PLACEHOLDER,
    );
  });

  it('every field has a kind; the blocks are listed after the values', () => {
    const kinds = MERGE_FIELDS.map((f) => f.kind);
    expect(kinds.lastIndexOf('value')).toBeLessThan(kinds.indexOf('block'));
    expect(MERGE_FIELDS.filter((f) => f.kind === 'block').map((f) => f.key)).toEqual([
      'showOrder',
      'judgeArrivalTime',
      'judgeNeeds',
      'questionnaireLink',
    ]);
  });
});

describe('usesField', () => {
  it('finds a field in the subject or body, spaces allowed, exact name only', () => {
    expect(usesField({ subject: '{{ questionnaireLink }}', body: '' }, 'questionnaireLink')).toBe(true);
    expect(usesField({ subject: '', body: 'x {{questionnaireLink}}' }, 'questionnaireLink')).toBe(true);
    expect(usesField({ subject: 'questionnaireLink', body: '{{questionnaireLinks}}' }, 'questionnaireLink')).toBe(false);
  });
});
