import type { Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { handledOf, openedOf, type Dealt, type DealtError } from './opened-of.js';
import type { PersonCaller } from './person-crew.js';
import type { OpenedDeliveries, PersonCrews, PersonShipDoor } from './ports.js';

export type DoneDelivery = (input: { caller: PersonCaller; deliveryId: string }) => Promise<Result<Dealt, DealtError>>;

/** Use case: a person is done with a delivery they opened, with no answer (Q20): it is handled. */
export function createDoneDelivery(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; opened: OpenedDeliveries }): DoneDelivery {
  return async (asked) => {
    const opened = await openedOf(deps, asked);
    return opened.isOk ? handledOf(deps, { caller: asked.caller, delivery: opened.value }) : opened;
  };
}
