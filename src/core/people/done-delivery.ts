import type { Result } from '../shared/result.js';
import type { Place } from './item-outcome.js';
import { handledOf, openedOf, type Dealt, type DealDeps, type DealtError } from './opened-of.js';
import type { PersonCaller } from './person-crew.js';

export type DoneDelivery = (input: { caller: PersonCaller; place: Place; deliveryId: string }) => Promise<Result<Dealt, DealtError>>;

/** Use case: a person is done with a delivery they opened, with no answer (Q20): it is handled, done where they were. */
export function createDoneDelivery(deps: DealDeps): DoneDelivery {
  return async ({ caller, place, deliveryId }) => {
    const opened = await openedOf(deps, { caller, deliveryId });
    return opened.isOk ? handledOf(deps, { caller, delivery: opened.value, as: { place, kind: 'done', option: null } }) : opened;
  };
}
