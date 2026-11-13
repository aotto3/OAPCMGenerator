import { describe, expect, it } from 'vitest';
import { createContest, withCmInfo } from '../model/contest';
import { docCmInfo } from './docVars';

const NOW = '2026-07-05T12:00:00.000Z';

describe('docCmInfo — CM identity projection with letter-family fallbacks', () => {
  it('falls back to neutral placeholders, never a real person, when the fields are blank', () => {
    const blank = withCmInfo(
      createContest({ id: 'x', now: NOW }),
      { name: '', email: '', phone: '', mailingAddress: '', website: '', techContact: '' },
      NOW,
    );
    expect(docCmInfo(blank)).toEqual({
      name: '[CM Name]',
      email: '[CM Email]',
      phone: '',
      mailingAddress: '',
      website: '',
      techContact: '[Host Technical Director]',
    });
  });

  it('passes provided values through unchanged', () => {
    const filled = withCmInfo(
      createContest({ id: 'x', now: NOW }),
      {
        name: 'Dana Cole',
        email: 'dana@example.edu',
        phone: '555-1234',
        mailingAddress: '1 Main St',
        website: 'example.edu',
        techContact: 'Sam Tech',
      },
      NOW,
    );
    expect(docCmInfo(filled)).toEqual({
      name: 'Dana Cole',
      email: 'dana@example.edu',
      phone: '555-1234',
      mailingAddress: '1 Main St',
      website: 'example.edu',
      techContact: 'Sam Tech',
    });
  });
});
