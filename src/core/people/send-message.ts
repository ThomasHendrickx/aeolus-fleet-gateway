import type { MessageId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { PersonCrews, PersonSelector, PersonShipDoor } from './ports.js';

/** Outbound port: a new key for a message the person gave none. */
export interface SendKeys {
  newIdempotencyKey(): string;
}

export type SendMessage = (input: {
  caller: PersonCaller;
  to: PersonSelector;
  contentType: string;
  payload: string;
  idempotencyKey?: string;
}) => Promise<Result<{ messageId: MessageId }, PersonCrewError | DomainError<'SEND_REFUSED'>>>;

/**
 * Use case: a person starts a message as their person ship (aeolus-fleet
 * #1046), to a ship by its name or any ship of a type. The fleet checks the
 * ship's scopes and the network rules at send time, so the gateway adds no
 * rule of its own and passes the fleet's reason on when it refuses. The
 * person's own key, when given, makes a send tried again go once.
 */
export function createSendMessage(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; keys: SendKeys }): SendMessage {
  return async ({ caller, to, contentType, payload, idempotencyKey }) => {
    const message = { to, contentType, payload, idempotencyKey: idempotencyKey ?? deps.keys.newIdempotencyKey() };
    const sent = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.send(crew.crewToken, message)) });
    if (!sent.isOk) {
      return sent;
    }
    const taken = sent.value.value;
    return taken.isOk ? ok(taken.value) : refuse('SEND_REFUSED', `The fleet did not take your message: ${taken.error.message}`);
  };
}
