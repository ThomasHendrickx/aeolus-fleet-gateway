import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ArgoAccounts } from './ports.js';

/** What an account token names that tells whether its account is reached as argo. */
export interface ArgoAccountToken {
  readonly accountId: string;
  readonly personShipId: ShipId | null;
  readonly isArgoAllowed: boolean;
}

export type NoteArgoAccount = (fleetId: FleetId, token: ArgoAccountToken) => Promise<void>;

/**
 * Use case: an account token the gateway is given, at a sign-in, an
 * exchange or a refresh, is the account's latest word on whether it is
 * allowed as argo (argo's inbox, AI9). Allowed with a person ship, the
 * account is kept, with that person ship; otherwise it is dropped, so an
 * account no longer allowed is dropped at its next token.
 */
export function createNoteArgoAccount(deps: { accounts: ArgoAccounts }): NoteArgoAccount {
  return async (fleetId, { accountId, personShipId, isArgoAllowed }) => {
    if (isArgoAllowed && personShipId !== null) {
      await deps.accounts.keep(fleetId, { accountId, personShipId });
    } else {
      await deps.accounts.drop(fleetId, accountId);
    }
  };
}
