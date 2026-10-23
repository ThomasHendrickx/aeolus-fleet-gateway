import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { EmailChannels } from './ports.js';

/** The channels that wake a person, as their overview shows them: each offered or not, and on or not. */
export interface WakeChannels {
  readonly email: { readonly isOffered: boolean; readonly isOn: boolean };
}

export type ReadWakeChannels = (caller: PersonCaller) => Promise<Result<WakeChannels, PersonCrewError>>;

/**
 * Use case: the channels that wake a person when something waits for their
 * person ship (wake a person, W8). Email is offered only where the gateway
 * can ask pagasae to send it; nothing is on by default.
 */
export function createReadWakeChannels(deps: { crewPersonShip: CrewPersonShip; emailChannels: EmailChannels; isEmailOffered: boolean }): ReadWakeChannels {
  return async (caller) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const isOn = deps.isEmailOffered && (await deps.emailChannels.isOn({ fleetId: caller.fleetId, shipId: crew.value.shipId }));
    return ok({ email: { isOffered: deps.isEmailOffered, isOn } });
  };
}
