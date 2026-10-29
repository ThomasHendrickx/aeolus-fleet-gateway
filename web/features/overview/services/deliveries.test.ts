import { ANSWER_CONTENT_TYPE } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { answerOf } from './deliveries';

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
