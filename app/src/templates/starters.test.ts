/**
 * Built-in starter texts (PRD #320): every starter uses only known fields, and
 * rendered against the document fixture (which has a CM phone and website) it
 * reads exactly like its built-in email. Tabulation is the one approximation;
 * it only has to share the built-in's subject.
 */
import { describe, expect, it } from 'vitest';
import { fixtureContest } from '../documents/__fixtures__/fixtureContest';
import {
  advancingEmail,
  announcementEmail,
  dayBeforeEmail,
  deadlineEmail,
  judgeNeedsEmail,
  judgesEmail,
  questionnaireEmail,
  type EmailDraft,
} from '../documents/emailTemplates';
import { contestFullName } from '../model/contest';
import { renderTemplate } from './templateRender';
import { STARTERS, starterInput, type Starter } from './starters';

const LINK = 'https://oap.example/q/abc';
const starter = (id: string): Starter => STARTERS.find((s) => s.id === id)!;
const render = (id: string) => renderTemplate(starter(id), fixtureContest(), { questionnaireLink: LINK });
const strip = (d: EmailDraft) => ({ subject: d.subject, body: d.body });

describe('starters', () => {
  it('covers the eight built-ins, once each', () => {
    expect(STARTERS.map((s) => s.id)).toEqual([
      'announcement',
      'deadline',
      'daybefore',
      'questionnaire',
      'judges',
      'judgeneeds',
      'advancing',
      'tabulation',
    ]);
  });

  it('use no unknown fields', () => {
    for (const s of STARTERS) expect(render(s.id).unknownFields).toEqual([]);
  });

  it('read exactly like their built-in emails', () => {
    const c = fixtureContest();
    const same = (id: string, built: EmailDraft) => {
      const { subject, body } = render(id);
      expect({ subject, body }).toEqual(strip(built));
    };
    same('announcement', announcementEmail(c));
    same('deadline', deadlineEmail(c));
    same('daybefore', dayBeforeEmail(c));
    same('questionnaire', questionnaireEmail(c, LINK));
    same('judges', judgesEmail(c));
    same('judgeneeds', judgeNeedsEmail(c));
    same('advancing', advancingEmail(c, [0]));
  });

  it('tabulation shares the built-in subject and asks the CM to paste the report', () => {
    const { subject, body } = render('tabulation');
    expect(subject).toBe(contestFullName(fixtureContest().identity) + ' - Panel Tabulation');
    expect(body).toContain('Attached is the panel tabulation for the ' + contestFullName(fixtureContest().identity));
    expect(body).toContain('[Paste the tabulation report');
  });
});

describe('starterInput', () => {
  it('names the copy after the built-in', () => {
    expect(starterInput(starter('judges'), [])).toEqual({
      name: 'My Judge Reminder',
      subject: starter('judges').subject,
      body: starter('judges').body,
    });
  });

  it('adds a number when the name is taken, ignoring case and spaces', () => {
    expect(starterInput(starter('judges'), [' my judge reminder ']).name).toBe('My Judge Reminder (2)');
    expect(starterInput(starter('judges'), ['My Judge Reminder', 'My Judge Reminder (2)']).name).toBe(
      'My Judge Reminder (3)',
    );
  });
});
