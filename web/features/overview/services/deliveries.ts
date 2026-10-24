/**
 * A delivery that waits on a person, as the Overview shows it once opened,
 * and the answer its form sends: pure view logic, no React and no API client.
 */
import { ANSWER_CONTENT_TYPE, answerSchema, isQuestionContentType, questionSchema, type Question } from '@aeolus-fleet/common';
import type { inferRouterOutputs } from '@trpc/server';

import type { GatewayRouter } from '../../../../src/adapters/trpc/router.js';

/** What waits on a person's own ship, as the API shows it. */
export type Inbox = inferRouterOutputs<GatewayRouter>['people']['inbox'];

/** The channels that wake a person when something waits for their person ship, as the API shows them (wake a person, W8). */
export type WakeChannels = inferRouterOutputs<GatewayRouter>['people']['wakeChannels'];

/** A delivery as the inbox lists it: by title only. */
export type InboxEntry = Inbox['deliveries'][number];

/**
 * A delivery in focus: whole once, as the person opened it, with its
 * question when it is one; or, opened before, by its title alone, as the
 * gateway keeps no payload.
 */
export interface FocusedDelivery {
  readonly deliveryId: string;
  readonly from: string;
  readonly title: string;
  readonly sentAt: string;
  readonly payload: string | undefined;
  readonly question: Question | undefined;
  /** The meeting it was contributed to or tells of, when it was opened now and belongs to one. */
  readonly meetingId: string | undefined;
}

/** A question, when the delivery is one the fleet's question content type carries. */
export function questionOf(opened: { contentType: string; payload: string }): Question | undefined {
  if (!isQuestionContentType(opened.contentType)) {
    return undefined;
  }
  try {
    const question = questionSchema.safeParse(JSON.parse(opened.payload));
    return question.success ? question.data : undefined;
  } catch {
    return undefined;
  }
}

/** What the person sends: an option they tapped and a note, or a note alone. */
export interface AnswerInput {
  readonly questionId: string | undefined;
  readonly option: number | undefined;
  readonly note: string;
}

/** The answer a form sends: an option and a note, or a note alone, for a question; a note as plain text otherwise. */
export function answerOf(input: AnswerInput): { isOk: true; value: { contentType: string; payload: string } } | { isOk: false; message: string } {
  const note = input.note.trim();
  if (input.questionId === undefined) {
    return note === '' ? { isOk: false, message: 'Write your answer first' } : { isOk: true, value: { contentType: 'text/plain', payload: note } };
  }
  const answer = answerSchema.safeParse({ questionId: input.questionId, ...(input.option === undefined ? {} : { option: input.option }), ...(note === '' ? {} : { note }) });
  return answer.success ? { isOk: true, value: { contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify(answer.data) } } : { isOk: false, message: 'Tap an option, or write a note' };
}
