import { answerChoiceSchema, isAnswerContentType } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import { answerKeyOf } from './basket.js';
import type { Place } from './item-outcome.js';
import { handledOf, openedOf, type Dealt, type DealDeps, type DealtError } from './opened-of.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller } from './person-crew.js';

export type AnswerDelivery = (input: { caller: PersonCaller; place: Place; deliveryId: string; contentType: string; payload: string }) => Promise<Result<Dealt, DealtError | DomainError<'SEND_REFUSED'>>>;

/** The option an answer to a question picked; none for a note alone or any other reply. */
function optionOf({ contentType, payload }: { contentType: string; payload: string }): number | null {
  if (!isAnswerContentType(contentType)) {
    return null;
  }
  try {
    const choice = answerChoiceSchema.safeParse(JSON.parse(payload)).data;
    return choice !== undefined && 'option' in choice ? choice.option : null;
  } catch {
    return null;
  }
}

/**
 * Use case: a person answers a delivery they opened (Q20): a reply to its
 * sender, in reply to its message, then it is handled, answered where they
 * answered it. An answer to a question is keyed by the question's uuid, as
 * the basket and Slack key it, so the fleet stores one answer per question
 * whichever place sends it; any other reply by the delivery's. Either way an
 * answer tried again after the fleet did not take handled is sent once.
 */
export function createAnswerDelivery(deps: DealDeps): AnswerDelivery {
  return async ({ caller, place, deliveryId, contentType, payload }) => {
    const opened = await openedOf(deps, { caller, deliveryId });
    if (!opened.isOk) {
      return opened;
    }
    const delivery = opened.value;
    const reply = { to: delivery.senderShipId, inReplyTo: delivery.messageId, contentType, payload, idempotencyKey: delivery.askedQuestionId === null ? `answer-${delivery.deliveryId}` : answerKeyOf({ questionId: delivery.askedQuestionId }) };
    const sent = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.reply(crew.crewToken, reply)) });
    if (!sent.isOk) {
      return sent;
    }
    if (!sent.value.value.isOk) {
      return refuse('SEND_REFUSED', `The fleet did not take your answer: ${sent.value.value.error.message}`);
    }
    return handledOf(deps, { caller, delivery, as: { place, kind: 'answered', option: optionOf({ contentType, payload }) } });
  };
}
