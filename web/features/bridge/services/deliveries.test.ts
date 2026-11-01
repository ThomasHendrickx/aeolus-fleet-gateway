import { ANSWER_CONTENT_TYPE } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { answerOf, bodyOf, questionOf, stepOf } from './deliveries';

const QUESTION_ID = '0b3f6a52-7c1e-4d0f-9a43-2f6c1d8e5b71';

describe("the answer a person's delivery form sends", () => {
  it('sends a note as plain text to a message', () => {
    expect(answerOf({ questionId: undefined, option: undefined, note: ' Yes, publish it ' })).toEqual({ isOk: true, value: { contentType: 'text/plain', payload: 'Yes, publish it' } });
  });

  it('asks for an answer before sending an empty note to a message', () => {
    expect(answerOf({ questionId: undefined, option: undefined, note: '  ' })).toEqual({ isOk: false, message: 'Write your answer first' });
  });

  it('sends the option tapped and the note to a question, as an answer', () => {
    expect(answerOf({ questionId: QUESTION_ID, option: 2, note: 'after lunch' })).toEqual({ isOk: true, value: { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION_ID, option: 2, note: 'after lunch' }) } });
  });

  it('sends a note alone to a question', () => {
    expect(answerOf({ questionId: QUESTION_ID, option: undefined, note: 'ask me tomorrow' })).toEqual({ isOk: true, value: { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION_ID, note: 'ask me tomorrow' }) } });
  });

  it('asks for an option or a note before answering a question with neither', () => {
    expect(answerOf({ questionId: QUESTION_ID, option: undefined, note: '' })).toEqual({ isOk: false, message: 'Tap an option, or write a note' });
  });
});

describe('what an opened item shows of its payload (Bridge, CC15)', () => {
  it("shows an alert's and a notice's body, not their JSON", () => {
    expect([
      bodyOf({ contentType: 'application/vnd.aeolus.alert+json', payload: JSON.stringify({ headline: 'builder-gateway: no report change for 2 h', body: 'Its last report, 17:46.' }) }),
      bodyOf({ contentType: 'application/vnd.aeolus.notice+json', payload: JSON.stringify({ headline: 'PR #1497 opened', body: 'Ready for review.' }) }),
    ]).toEqual(['Its last report, 17:46.', 'Ready for review.']);
  });

  it('shows any other payload as it came, and one it cannot read as it came too', () => {
    expect([bodyOf({ contentType: 'text/plain', payload: 'The build is red' }), bodyOf({ contentType: 'application/vnd.aeolus.notice+json', payload: 'not json' })]).toEqual(['The build is red', 'not json']);
  });
});

describe('the question an opened item asks (decision 0038)', () => {
  const QUESTION = { id: QUESTION_ID, title: 'Go for release 1.4?', context: 'All checks are green.', options: [{ key: 1, label: 'Go', detail: '' }], pick: { option: 1, why: 'Every check is green' } };

  it("reads a question's own, and the new question a replacement asks, so it is answered as a question", () => {
    const replacing = { ...QUESTION, id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f', title: 'Go for release 1.4 after #1488?' };

    expect([
      questionOf({ contentType: 'application/vnd.aeolus.question+json', payload: JSON.stringify(QUESTION) })?.id,
      questionOf({ contentType: 'application/vnd.aeolus.question-replacement+json', payload: JSON.stringify({ questionId: QUESTION_ID, question: replacing }) })?.id,
      questionOf({ contentType: 'application/vnd.aeolus.question-withdrawal+json', payload: JSON.stringify({ questionId: QUESTION_ID }) }),
    ]).toEqual([QUESTION_ID, '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f', undefined]);
  });
});

describe('a step, as Bridge shows it (CC14)', () => {
  const STEP = { id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Sign in to attio', why: 'A ship of yours called attio.', link: 'https://gateway.example.com/outside-parties/attio?fleet=flt_01' };

  it("reads its title, why, and its link with where it leads, host and path, inside Aeolus when Bridge's own host serves it", () => {
    expect(stepOf({ contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify(STEP) }, 'gateway.example.com')).toEqual({ title: 'Sign in to attio', why: 'A ship of yours called attio.', link: { href: STEP.link, address: 'gateway.example.com/outside-parties/attio', isOutside: false } });
  });

  it('reads a link to any other host as one that leads outside Aeolus, shown by host and path without its query', () => {
    const outside = { ...STEP, link: 'https://github.com/new?owner=ThomasHendrickx' };

    expect(stepOf({ contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify(outside) }, 'gateway.example.com')?.link).toEqual({ href: outside.link, address: 'github.com/new', isOutside: true });
  });

  it('shows a link to a host alone by its host', () => {
    const bare = { ...STEP, link: 'https://linear.app/' };

    expect(stepOf({ contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify(bare) }, 'gateway.example.com')?.link?.address).toBe('linear.app');
  });

  it('reads a step with no link as one with none', () => {
    const unlinked = { id: STEP.id, title: STEP.title, why: STEP.why };

    expect(stepOf({ contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify(unlinked) }, 'gateway.example.com')).toEqual({ title: 'Sign in to attio', why: 'A ship of yours called attio.', link: undefined });
  });

  it('reads the new step a step replacement asks, so it is done as a step', () => {
    const replacing = { id: '7a2d3b51-6e2c-4c9f-8b62-1d9f4a3b8e21', title: 'Sign in to attio with the team account', why: 'The team owns attio now.' };

    expect(stepOf({ contentType: 'application/vnd.aeolus.step-replacement+json', payload: JSON.stringify({ stepId: STEP.id, step: replacing }) }, 'gateway.example.com')).toEqual({ title: 'Sign in to attio with the team account', why: 'The team owns attio now.', link: undefined });
  });

  it.each([
    { what: 'any other message', contentType: 'text/plain', payload: JSON.stringify(STEP) },
    { what: 'a step whose payload does not read', contentType: 'application/vnd.aeolus.step+json', payload: 'not json' },
    { what: 'a step whose link is not http(s)', contentType: 'application/vnd.aeolus.step+json', payload: JSON.stringify({ ...STEP, link: 'javascript:alert(1)' }) },
    { what: 'a step withdrawal', contentType: 'application/vnd.aeolus.step-withdrawal+json', payload: JSON.stringify({ stepId: STEP.id }) },
  ])('reads no step of $what', ({ contentType, payload }) => {
    expect(stepOf({ contentType, payload }, 'gateway.example.com')).toBeUndefined();
  });
});
