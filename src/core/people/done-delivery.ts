import type { PartyStore } from '../parties/ports.js';
import type { Result } from '../shared/result.js';
import { handledOf, openedOf, type Dealt, type DealtError } from './opened-of.js';
import type { OpenedDeliveries, PersonShipDoor } from './ports.js';
import type { PersonCaller } from './read-inbox.js';

export type DoneDelivery = (input: { caller: PersonCaller; deliveryId: string }) => Promise<Result<Dealt, DealtError>>;

/** Use case: a person is done with a delivery they opened, with no answer (Q20): it is handled. */
export function createDoneDelivery(deps: { parties: PartyStore; door: PersonShipDoor; opened: OpenedDeliveries }): DoneDelivery {
  return async (asked) => {
    const opened = await openedOf(deps, asked);
    return opened.isOk ? handledOf(deps, opened.value) : opened;
  };
}
