import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import type { Place } from './item-outcome.js';
import { handledOf, openedOf, type Dealt, type DealDeps, type DealtError } from './opened-of.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller } from './person-crew.js';
import { noteOf, STEP_OUTCOME_CONTENT_TYPE, stepOutcomePayloadOf, type StepOutcomeKind } from './step-outcome.js';

export type DoneDelivery = (input: {
  caller: PersonCaller;
  place: Place;
  deliveryId: string;
  /** How a step ended: done unless named; only a step may end as cannot. */
  outcome?: StepOutcomeKind;
  /** The person's note on a step, for done and cannot alike; only a step takes one. */
  note?: string;
}) => Promise<Result<Dealt, DealtError | DomainError<'SEND_REFUSED' | 'NOT_A_STEP'>>>;

/**
 * Use case: a person is done with a delivery they opened (Q20): it is
 * handled, done where they were. A step (Bridge, CC14) ends done or cannot,
 * with the note if they wrote one: its outcome goes to the asker at once,
 * in reply to the step, never through the basket (CC23), and only then is
 * it handled. The outcome's key is the delivery's, so one tried again after
 * the fleet did not take handled is sent once. Any other delivery sends
 * nothing, so cannot and a note are refused for it.
 */
export function createDoneDelivery(deps: DealDeps): DoneDelivery {
  return async ({ caller, place, deliveryId, outcome = 'done', note }) => {
    const opened = await openedOf(deps, { caller, deliveryId });
    if (!opened.isOk) {
      return opened;
    }
    const delivery = opened.value;
    const { stepId } = delivery;
    if (stepId === null) {
      if (outcome === 'cannot' || noteOf(note) !== null) {
        return refuse('NOT_A_STEP', `${delivery.title} is no step: only a step ends as cannot or takes a note. Answer it with your note instead`);
      }
      return handledOf(deps, { caller, delivery, as: { place, kind: 'done', option: null } });
    }
    const reply = { to: delivery.senderShipId, inReplyTo: delivery.messageId, contentType: STEP_OUTCOME_CONTENT_TYPE, payload: stepOutcomePayloadOf({ stepId, kind: outcome, note: noteOf(note) }), idempotencyKey: `step-outcome-${delivery.deliveryId}` };
    const sent = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.reply(crew.crewToken, reply)) });
    if (!sent.isOk) {
      return sent;
    }
    if (!sent.value.value.isOk) {
      return refuse('SEND_REFUSED', `The fleet did not take your outcome: ${sent.value.value.error.message}`);
    }
    return handledOf(deps, { caller, delivery, as: { place, kind: outcome, option: null } });
  };
}
