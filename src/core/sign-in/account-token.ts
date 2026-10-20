import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { IssuedTokens } from '../oauth/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { AccountGrants, Pagasae } from './ports.js';

/** An account token is refreshed when less than this is left of it, so a call never carries one that ends on the way. */
export const ACCOUNT_TOKEN_MARGIN_MS = 60_000;

/**
 * Why there is no account token to call with:
 * - signedOut: the gateway holds no such grant, or pagasae ended it, so the person signs in again;
 * - pagasaeUnavailable: pagasae did not answer; the grant stays.
 */
export type AccountTokenRefusal = { readonly kind: 'signedOut' } | { readonly kind: 'pagasaeUnavailable' };

export type AccountTokenOf = (grant: { fleetId: FleetId; grantId: string }) => Promise<Result<{ accountToken: string; personShipId: ShipId | null }, AccountTokenRefusal>>;

/**
 * Use case: the account token a signed-in person's call carries to core
 * (decisions 0054, 0058). It lasts 10 minutes; a minute before it ends the
 * gateway refreshes it through pagasae, which replaces the refresh token. A
 * grant's calls made together share one refresh, as pagasae ends a grant
 * whose refresh token comes twice. pagasae refusing ends the grant here too,
 * revoking its client's tokens, so the person signs in again.
 */
export function createAccountTokenOf(deps: { grants: AccountGrants; tokens: IssuedTokens; pagasae: Pagasae; clock: Clock }): AccountTokenOf {
  const refreshing = new Map<string, ReturnType<AccountTokenOf>>();

  const fresh: AccountTokenOf = async ({ fleetId, grantId }) => {
    const grant = await deps.grants.find(fleetId, grantId);
    if (grant === undefined) {
      return err({ kind: 'signedOut' });
    }
    if (grant.accountTokenExpiresAt.getTime() - ACCOUNT_TOKEN_MARGIN_MS > deps.clock.now().getTime()) {
      return ok({ accountToken: grant.accountToken, personShipId: grant.personShipId });
    }
    const refreshed = await deps.pagasae.refresh(grant.refreshToken);
    if (!refreshed.isOk && refreshed.error.kind === 'unavailable') {
      return err({ kind: 'pagasaeUnavailable' });
    }
    if (!refreshed.isOk || refreshed.value.fleetId !== fleetId) {
      await deps.grants.end(fleetId, grantId);
      await deps.tokens.revokeGrant(fleetId, grantId);
      return err({ kind: 'signedOut' });
    }
    const { refreshToken, accountToken, accountTokenExpiresAt, personShipId } = refreshed.value;
    await deps.grants.renew({ fleetId, grantId }, { refreshToken, accountToken, accountTokenExpiresAt, personShipId });
    return ok({ accountToken, personShipId });
  };

  return (grant) => {
    const key = `${grant.fleetId}/${grant.grantId}`;
    const held = refreshing.get(key);
    if (held !== undefined) {
      return held;
    }
    const answer = fresh(grant).finally(() => refreshing.delete(key));
    refreshing.set(key, answer);
    return answer;
  };
}
