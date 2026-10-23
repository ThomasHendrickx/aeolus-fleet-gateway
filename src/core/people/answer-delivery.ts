import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { handledOf, openedOf, type Dealt, type DealtError } from './opened-of.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller } from './person-crew.js';
import type { InboxChanges, OpenedDeliveries, PersonCrews, PersonShipDoor } from './ports.js';

export type AnswerDelivery = (input: { caller: PersonCaller; deliveryId: string; contentType: string; payload: string }) => Promise<Result<Dealt, DealtError | DomainError<'SEND_REFUSED'>>>;

/**
 * Use case: a person answers a delivery they opened (Q20): a reply to its
 * sender, in reply to its message, then it is handled. The reply's key is
 * the delivery's, so an answer tried again after the fleet did not take
 * handled is sent once.
 */
export function createAnswerDelivery(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; opened: OpenedDeliveries; changes: InboxChanges }): AnswerDelivery {
  return async ({ caller, deliveryId, contentType, payload }) => {
    const opened = await openedOf(deps, { caller, deliveryId });
    if (!opened.isOk) {
      return opened;
    }
    const delivery = opened.value;
    const reply = { to: delivery.senderShipId, inReplyTo: delivery.messageId, contentType, payload, idempotencyKey: `answer-${delivery.deliveryId}` };
    const sent = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.reply(crew.crewToken, reply)) });
    if (!sent.isOk) {
      return sent;
    }
    if (!sent.value.value.isOk) {
      return refuse('SEND_REFUSED', `The fleet did not take your answer: ${sent.value.value.error.message}`);
    }
    return handledOf(deps, { caller, delivery });
  };
}
