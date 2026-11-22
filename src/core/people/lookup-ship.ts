/** A conversation header reads only its chosen ship, with current send reach decided by core. */
import type { FleetRefusal } from '../connection/ports.js';
import type { DomainError } from '../shared/errors.js';
import { err, ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { PersonCrews, PersonShipDoor, ShipHeader, ShipLookup } from './ports.js';

type LookupError = PersonCrewError | (DomainError<'LOOKUP_REFUSED'> & FleetRefusal);
export type LookupShip = (input: { caller: PersonCaller; target: ShipLookup }) => Promise<Result<ShipHeader | null, LookupError>>;

export function createLookupShip(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor }): LookupShip {
  return async ({ caller, target }) => {
    const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.lookupHeader(crew.crewToken, target)) });
    if (!read.isOk) return read;
    const answer = read.value.value;
    return answer.isOk ? ok(answer.value) : err({ kind: 'LOOKUP_REFUSED', ...answer.error });
  };
}
