import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { AccountOfSignIn } from '../account-sign-in/account-of-sign-in.js';
import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { AuthenticateOperator } from '../operator/authenticate-operator.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * Who calls the gateway's API (decision 0057): an account by the shared
 * sign-in the web app's page forwarded (header design H5), argo or a viewer
 * by the console session, or a ship by its own crew token. Its scopes are the
 * fleet's or its account token's, never the request's, plugin scopes such
 * as gateway:approve among them.
 */
export type Actor =
  | { readonly fleetId: FleetId; readonly kind: 'operator' | 'viewer'; readonly scopes: readonly string[] }
  | { readonly fleetId: FleetId; readonly kind: 'ship'; readonly shipId: ShipId; readonly scopes: readonly string[] }
  | AccountActor;

/** An account on the gateway's pages, by the account token pagasae exchanged its shared sign-in for. */
export interface AccountActor {
  readonly fleetId: FleetId;
  readonly kind: 'account';
  readonly accountId: string;
  readonly personShipId: ShipId | null;
  readonly accountToken: string;
  readonly scopes: readonly string[];
}

export type AuthenticateActor = (sent: { cookie?: string | undefined; crewToken?: string | undefined; signIn?: string | undefined; fleetId?: FleetId | undefined }) => Promise<Result<Actor, DomainError<'NOT_AN_ACTOR'>>>;

/**
 * Use case: whom a call of the gateway's API is for. A crew token, sent
 * deliberately, names its ship: the fleet says which ship it crews, and the
 * gateway, as its own ship in that fleet, reads the ship's scopes. A ship of
 * a fleet the gateway is not connected to is no actor here. The crew token
 * is never kept. Else the shared sign-in the page forwarded names an account
 * in the fleet the page names, by the account token pagasae exchanges it
 * for. Else the console session cookie names argo or a viewer.
 */
export function createAuthenticateActor(deps: {
  authenticateOperator: AuthenticateOperator;
  door: Pick<FleetDoor, 'whoami' | 'getShip'>;
  connections: Pick<ConnectionStore, 'find'>;
  accountOf: AccountOfSignIn;
}): AuthenticateActor {
  const refusal = refuse('NOT_AN_ACTOR', 'Sign in to the console of your fleet, or call with your ship\'s crew token');
  return async ({ cookie, crewToken, signIn, fleetId }) => {
    if (crewToken !== undefined) {
      const who = await deps.door.whoami(crewToken);
      if (!who.isOk) {
        return refusal;
      }
      const gateway = await deps.connections.find(who.value.fleetId);
      if (gateway === undefined) {
        return refusal;
      }
      // On the ship's own behalf: its read reach holds itself, whatever the gateway's ship reaches (decision 0034).
      const ship = await deps.door.getShip(gateway.crewToken, { shipId: who.value.shipId, onBehalfOf: who.value.shipId });
      return ship.isOk ? ok({ fleetId: who.value.fleetId, kind: 'ship', shipId: who.value.shipId, scopes: ship.value.scopes }) : refusal;
    }
    if (signIn !== undefined && fleetId !== undefined) {
      const token = await deps.accountOf({ signIn, fleetId });
      if (!token.isOk) {
        return refusal;
      }
      const { accountId, personShipId, scopes, accountToken } = token.value;
      return ok({ fleetId, kind: 'account', accountId, personShipId, accountToken, scopes });
    }
    const operator = await deps.authenticateOperator(cookie);
    return operator.isOk ? ok(operator.value) : refusal;
  };
}
