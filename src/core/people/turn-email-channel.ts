import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { EmailChannels } from './ports.js';

export type TurnEmailChannel = (turn: { caller: PersonCaller; isOn: boolean }) => Promise<Result<undefined, PersonCrewError | DomainError<'CHANNEL_NOT_OFFERED'>>>;

/**
 * Use case: a person turns email on or off, to be woken when something
 * waits for their person ship (wake a person, W8), kept by fleet and person
 * ship. Turning it on is refused where the gateway cannot send email.
 */
export function createTurnEmailChannel(deps: { crewPersonShip: CrewPersonShip; emailChannels: EmailChannels; isEmailOffered: boolean; clock: Clock }): TurnEmailChannel {
  return async ({ caller, isOn }) => {
    if (isOn && !deps.isEmailOffered) {
      return refuse('CHANNEL_NOT_OFFERED', 'This gateway sends no email');
    }
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    await deps.emailChannels.turn({ fleetId: caller.fleetId, shipId: crew.value.shipId }, { isOn, at: deps.clock.now() });
    return ok(undefined);
  };
}
