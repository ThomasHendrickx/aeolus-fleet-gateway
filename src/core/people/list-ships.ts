import type { FleetRefusal } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { PersonCrews, PersonDiscovery, PersonShipDoor } from './ports.js';

export type ListShips = (caller: PersonCaller) => Promise<Result<PersonDiscovery, PersonCrewError | DomainError<'SEND_REFUSED'>>>;

/**
 * Use case: a person reads the ships and types their person ship may send to
 * now, with what each offers (aeolus-fleet #1046). It is the fleet's
 * discover and full statement lookup, as the person ship, so its scopes and the network rules
 * decide it; the gateway adds no rule of its own.
 */
export function createListShips(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor }): ListShips {
  return async (caller) => {
    const read = async (crewToken: string): Promise<Result<PersonDiscovery, FleetRefusal>> => {
      const discovery = await deps.door.discover(crewToken);
      if (!discovery.isOk) return discovery;
      const ships: PersonDiscovery['ships'][number][] = [];
      for (const ship of discovery.value.ships) {
        const detail = await deps.door.lookup(crewToken, ship.id);
        if (!detail.isOk) return detail;
        if (detail.value !== null) ships.push({ ...ship, statement: detail.value.statement });
      }
      return ok({ ships, types: discovery.value.types });
    };
    const found = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(read(crew.crewToken)) });
    if (!found.isOk) {
      return found;
    }
    const discovery = found.value.value;
    return discovery.isOk ? ok(discovery.value) : refuse('SEND_REFUSED', `The fleet did not say what you may send to: ${discovery.error.message}`);
  };
}
