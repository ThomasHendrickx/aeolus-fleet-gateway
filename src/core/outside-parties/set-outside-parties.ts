import type { Actor } from '../actors/authenticate-actor.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ActorCredential, FleetNetwork, OutsidePartySwitches } from './ports.js';

/** The scope that switches a fleet's outside parties, as it changes the fleet's network. */
export const SWITCHING_SCOPE = 'fleet:network';

export type ReadOutsideParties = (actor: Actor) => Promise<{ isOn: boolean }>;

export type SetOutsideParties = (input: {
  actor: Actor;
  as: ActorCredential;
  isOn: boolean;
  isOpenNetworkConfirmed: boolean;
}) => Promise<Result<{ isOn: boolean }, DomainError<'NOT_A_NETWORKER' | 'OPEN_NETWORK' | 'FLEET_UNAVAILABLE'>>>;

/** Use case: whether the actor's fleet's outside parties are on. */
export function createReadOutsideParties(deps: { switches: OutsidePartySwitches }): ReadOutsideParties {
  return async (actor) => ({ isOn: await deps.switches.isOn(actor.fleetId) });
}

/**
 * Use case: an actor holding fleet:network turns the fleet's outside parties
 * on or off (interop I-3). The gateway sets no policy but warns: turning
 * them on while the fleet applies no network rules needs the warning
 * confirmed. The rules are read as the actor, so the fleet answers what that
 * actor may see. Turning off reads nothing.
 */
export function createSetOutsideParties(deps: { switches: OutsidePartySwitches; network: FleetNetwork; clock: Clock }): SetOutsideParties {
  return async ({ actor, as, isOn, isOpenNetworkConfirmed }) => {
    if (!actor.scopes.includes(SWITCHING_SCOPE)) {
      return refuse('NOT_A_NETWORKER', `Switching outside parties needs ${SWITCHING_SCOPE}`);
    }
    if (isOn && !isOpenNetworkConfirmed) {
      const isOpen = await deps.network.isOpen(as);
      if (!isOpen.isOk) {
        return refuse('FLEET_UNAVAILABLE', `The fleet did not say its network rules: ${isOpen.error.message}`);
      }
      if (isOpen.value) {
        return refuse('OPEN_NETWORK', 'This fleet applies no network rules, so every outside party would reach every ship. Confirm to turn outside parties on anyway.');
      }
    }
    await deps.switches.set(actor.fleetId, { isOn, at: deps.clock.now() });
    return ok({ isOn });
  };
}
