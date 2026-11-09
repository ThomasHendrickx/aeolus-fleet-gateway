import type { ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { PersonCrews, PersonShipDoor } from './ports.js';

/** The fleet's code for a call it gave no answer to. */
const NO_ANSWER = 'UNAVAILABLE';

/** Who the person can send a message to: the ships their person ship may send to now, by name, each name's ship id, and the person ship's name it is sent as. */
export interface SendTo {
  readonly sentAs: string;
  readonly ships: readonly string[];
  readonly shipSummaries: Readonly<Record<string, string>>;
  readonly shipIds: Readonly<Record<string, ShipId>>;
}

export type ReadSendTo = (caller: PersonCaller) => Promise<Result<SendTo, PersonCrewError | DomainError<'SEND_REFUSED'>>>;

/**
 * Use case: Bridge's form to send a ship a message (aeolus-fleet #1547)
 * reads who the person can send to. It is the fleet's discover, as the
 * person ship, so the ship's scopes and the network rules decide it; the
 * gateway adds no rule of its own. The fleet's whoami names the person ship
 * the message is sent as.
 */
export function createReadSendTo(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor }): ReadSendTo {
  return async (caller) => {
    const read = await asPersonCrew<Result<SendTo, FleetRefusal>>(deps, {
      caller,
      run: async (crew) => {
        const who = await deps.door.whoami(crew.crewToken);
        if (!who.isOk) {
          return withOwnRefusal(Promise.resolve(who));
        }
        const found = await deps.door.discover(crew.crewToken);
        const sendTo: Result<SendTo, FleetRefusal> = found.isOk ? ok({ sentAs: who.value.name, ships: found.value.ships.map(({ name }) => name).toSorted((one, other) => one.localeCompare(other)), shipIds: Object.fromEntries(found.value.ships.map(({ id, name }) => [name, id])), shipSummaries: Object.fromEntries(found.value.ships.flatMap(({ name, statement }) => statement?.by === 'crew' ? [[name, statement.summary]] : [])) }) : found;
        return withOwnRefusal(Promise.resolve(sendTo));
      },
    });
    if (!read.isOk) {
      return read;
    }
    const sendTo = read.value.value;
    if (sendTo.isOk) {
      return ok(sendTo.value);
    }
    return sendTo.error.code === NO_ANSWER ? refuse('FLEET_UNAVAILABLE', sendTo.error.message) : refuse('SEND_REFUSED', `The fleet did not say what you may send to: ${sendTo.error.message}`);
  };
}
