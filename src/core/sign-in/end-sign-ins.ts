import type { FleetId } from '@aeolus-fleet/common';

import type { IssuedTokens } from '../oauth/ports.js';
import type { AccountGrants } from './ports.js';

export type EndSignIns = (account: { fleetId: FleetId; accountId: string }) => Promise<void>;

/**
 * Use case: pagasae disabled the account and tells the gateway, which ends
 * its gateway tokens there (decision 0055): every sign-in of the account in
 * the fleet ends, and its clients' tokens are revoked, so each client is
 * refused at its next call. pagasae refuses the account a new sign-in. A
 * grant is ended before its tokens are revoked, as when pagasae refuses a
 * refresh: a call with a token whose grant is gone is signed out already.
 */
export function createEndSignIns(deps: { grants: AccountGrants; tokens: IssuedTokens }): EndSignIns {
  return async ({ fleetId, accountId }) => {
    for (const { grantId } of await deps.grants.ofAccount(fleetId, accountId)) {
      await deps.grants.end(fleetId, grantId);
      await deps.tokens.revokeGrant(fleetId, grantId);
    }
  };
}
