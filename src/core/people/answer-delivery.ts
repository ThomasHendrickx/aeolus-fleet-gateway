import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import { handledOf, openedOf, type Dealt, type DealtError } from './opened-of.js';
import type { OpenedDeliveries, PersonShipDoor } from './ports.js';
import type { PersonCaller } from './read-inbox.js';

export type AnswerDelivery = (input: { caller: PersonCaller; deliveryId: string; contentType: string; payload: string }) => Promise<Result<Dealt, DealtError | DomainError<'SEND_REFUSED'>>>;

/**
 * Use case: a person answers a delivery they opened (Q20): a reply to its
 * sender, in reply to its message, then it is handled. The reply's key is
 * the delivery's, so an answer tried again after the fleet did not take
 * handled is sent once.
 */
export function createAnswerDelivery(deps: { parties: PartyStore; door: PersonShipDoor; opened: OpenedDeliveries }): AnswerDelivery {
  return async ({ caller, deliveryId, contentType, payload }) => {
    const opened = await openedOf(deps, { caller, deliveryId });
    if (!opened.isOk) {
      return opened;
    }
    const { crewToken, delivery } = opened.value;
    const sent = await deps.door.reply(crewToken, { to: delivery.senderShipId, inReplyTo: delivery.messageId, contentType, payload, idempotencyKey: `answer-${delivery.deliveryId}` });
    if (!sent.isOk) {
      return refuse('SEND_REFUSED', `The fleet did not take your answer: ${sent.error.message}`);
    }
    return handledOf(deps, opened.value);
  };
}
