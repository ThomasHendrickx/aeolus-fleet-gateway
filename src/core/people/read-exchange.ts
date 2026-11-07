import type { ShipId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { EXCHANGE_PAGE_SIZE, exchangeRefusalOf, type ExchangeRefusal } from './exchange.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { ExchangePage, ExchangeStart, PersonCrews, PersonShipDoor } from './ports.js';

export type ReadExchange = (input: { caller: PersonCaller; otherShipId: ShipId; start: ExchangeStart }) => Promise<Result<ExchangePage, PersonCrewError | ExchangeRefusal>>;

/**
 * Use case: a person's client reads what their person ship and one other
 * ship said to each other, as one chat: both ways, whole, newest first, a
 * page of 20, older, newer or around one message, as core answers it. The
 * gateway keeps no copy, and reading acknowledges nothing, so a question,
 * a step, an alert or a notice stays as it was. A payload the fleet cannot
 * unseal now stays marked unreadable and the page still answers.
 */
export function createReadExchange(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor }): ReadExchange {
  return async ({ caller, otherShipId, start }) => {
    const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.exchange(crew.crewToken, { otherShipId, start, limit: EXCHANGE_PAGE_SIZE })) });
    if (!read.isOk) {
      return read;
    }
    const page = read.value.value;
    return page.isOk ? ok(page.value) : exchangeRefusalOf(page.error, { doing: 'The exchange cannot be read', missing: start.kind === 'around' ? 'message' : 'ship' });
  };
}
