import type { MessageId, ShipId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { exchangeRefusalOf, type ExchangeRefusal } from './exchange.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { PersonCrews, PersonShipDoor } from './ports.js';

export type MarkSeen = (input: { caller: PersonCaller; otherShipId: ShipId; messageId: MessageId }) => Promise<Result<{ acknowledged: number }, PersonCrewError | ExchangeRefusal>>;

/**
 * Use case: a person marks one ship's plain messages seen up to one
 * message, in one call, as the person ship's crew. Core acknowledges them
 * and leaves a question, a step, an alert and a notice as it was, so what
 * waits on the person stays true; marking again acknowledges none. When the
 * fleet does not answer, nothing was marked and the person marks again.
 */
export function createMarkSeen(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor }): MarkSeen {
  return async ({ caller, otherShipId, messageId }) => {
    const marked = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.ackUpTo(crew.crewToken, { otherShipId, messageId })) });
    if (!marked.isOk) {
      return marked;
    }
    const answered = marked.value.value;
    return answered.isOk ? ok(answered.value) : exchangeRefusalOf(answered.error, 'The exchange cannot be marked seen');
  };
}
