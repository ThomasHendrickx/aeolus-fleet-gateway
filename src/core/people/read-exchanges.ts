import type { MessageId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { EXCHANGE_PAGE_SIZE, exchangeRefusalOf, type ExchangeRefusal } from './exchange.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { ExchangeList, PersonCrews, PersonShipDoor } from './ports.js';

export type ReadExchanges = (input: { caller: PersonCaller; cursor: MessageId | null }) => Promise<Result<ExchangeList, PersonCrewError | ExchangeRefusal>>;

/**
 * Use case: a person's client lists the latest exchange with each other
 * ship, newest first, a page of 20, with how many of that ship's messages
 * are not yet seen, as core's rollup answers it, so Home lists new messages
 * by ship and never counts history. The gateway keeps no copy, and reading
 * marks nothing.
 */
export function createReadExchanges(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor }): ReadExchanges {
  return async ({ caller, cursor }) => {
    const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.exchanges(crew.crewToken, { cursor, limit: EXCHANGE_PAGE_SIZE })) });
    if (!read.isOk) {
      return read;
    }
    const page = read.value.value;
    return page.isOk ? ok(page.value) : exchangeRefusalOf(page.error, 'The exchanges cannot be read');
  };
}
