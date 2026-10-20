import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { AccountTokenOf, AccountTokenRefusal } from '../sign-in/account-token.js';
import type { AccountDoor, PersonCrews } from './ports.js';

/** The fleet's code for a ship that is crewed already: a starting prompt waits for its release. */
const SHIP_CREWED = 'CONFLICT';

/**
 * Why the gateway has no crew for the person's ship, beside why it has no account token:
 * - noPersonShip: the account has none in the fleet, as it may not message there (decision 0052);
 * - notConnected: the gateway holds no crew token for its own ship in the fleet;
 * - fleetRefused: the fleet refused a call, for the reason given.
 */
export type CrewPersonShipRefusal = AccountTokenRefusal | { readonly kind: 'noPersonShip' } | { readonly kind: 'notConnected' } | { readonly kind: 'fleetRefused'; readonly message: string };

export type CrewPersonShip = (grant: { fleetId: FleetId; grantId: string }) => Promise<Result<{ shipId: ShipId; crewToken: string }, CrewPersonShipRefusal>>;

/**
 * Use case: the crew of a signed-in person's person ship (decisions 0054,
 * 0057). The gateway crews it once and every client of the person shares
 * that crew, as a ship has one crew at a time (decision 0010). To crew it,
 * the gateway acts as the account, with its token beside the gateway's crew
 * token: it gets the ship's starting prompt, releasing the ship first when a
 * crew the gateway does not hold has it, and registers with its secret.
 */
export function createCrewPersonShip(deps: {
  accountTokenOf: AccountTokenOf;
  connections: ConnectionStore;
  door: AccountDoor & Pick<FleetDoor, 'register'>;
  crews: PersonCrews;
  clock: Clock;
}): CrewPersonShip {
  const crewing = new Map<string, Promise<Result<{ crewToken: string }, CrewPersonShipRefusal>>>();

  const crew = async (call: { fleetId: FleetId; shipId: ShipId; accountToken: string }): Promise<Result<{ crewToken: string }, CrewPersonShipRefusal>> => {
    const { fleetId, shipId, accountToken } = call;
    const gateway = await deps.connections.find(fleetId);
    if (gateway === undefined) {
      return err({ kind: 'notConnected' });
    }
    const asAccount = { crewToken: gateway.crewToken, accountToken, shipId };
    let prompt = await deps.door.startingPrompt(asAccount);
    if (!prompt.isOk && prompt.error.code === SHIP_CREWED) {
      const released = await deps.door.release(asAccount);
      if (!released.isOk) {
        return err({ kind: 'fleetRefused', message: released.error.message });
      }
      prompt = await deps.door.startingPrompt(asAccount);
    }
    if (!prompt.isOk) {
      return err({ kind: 'fleetRefused', message: prompt.error.message });
    }
    const registered = await deps.door.register({ shipId, secret: prompt.value.secret });
    if (!registered.isOk) {
      return err({ kind: 'fleetRefused', message: registered.error.message });
    }
    await deps.crews.save({ fleetId, shipId, crewToken: registered.value.crewToken, crewedAt: deps.clock.now() });
    return ok({ crewToken: registered.value.crewToken });
  };

  return async (grant) => {
    const token = await deps.accountTokenOf(grant);
    if (!token.isOk) {
      return token;
    }
    const { accountToken, personShipId: shipId } = token.value;
    if (shipId === null) {
      return err({ kind: 'noPersonShip' });
    }
    const held = await deps.crews.find(grant.fleetId, shipId);
    if (held !== undefined) {
      return ok({ shipId, crewToken: held.crewToken });
    }
    const key = `${grant.fleetId}/${shipId}`;
    const answer = crewing.get(key) ?? crew({ fleetId: grant.fleetId, shipId, accountToken }).finally(() => crewing.delete(key));
    crewing.set(key, answer);
    const crewed = await answer;
    return crewed.isOk ? ok({ shipId, crewToken: crewed.value.crewToken }) : crewed;
  };
}
