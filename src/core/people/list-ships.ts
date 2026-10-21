import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { PersonCrews, PersonDiscovery, PersonShipDoor } from './ports.js';

export type ListShips = (caller: PersonCaller) => Promise<Result<PersonDiscovery, PersonCrewError | DomainError<'SEND_REFUSED'>>>;

/**
 * Use case: a person reads the ships and types their person ship may send to
 * now, with what each offers (aeolus-fleet #1046). It is the fleet's
 * discover, as the person ship, so the ship's scopes and the network rules
 * decide it; the gateway adds no rule of its own.
 */
export function createListShips(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor }): ListShips {
  return async (caller) => {
    const found = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.discover(crew.crewToken)) });
    if (!found.isOk) {
      return found;
    }
    const discovery = found.value.value;
    return discovery.isOk ? ok(discovery.value) : refuse('SEND_REFUSED', `The fleet did not say what you may send to: ${discovery.error.message}`);
  };
}
