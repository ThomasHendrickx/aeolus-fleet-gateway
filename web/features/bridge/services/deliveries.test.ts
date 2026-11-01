import { ANSWER_CONTENT_TYPE } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { answerOf, bodyOf } from './deliveries';

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
