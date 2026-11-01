/** argo's inbox as the gateway reads it, in memory for a test. */
import type { FleetId } from '@aeolus-fleet/common';

import type { ArgoAccount, ArgoAccounts } from '../../src/core/argo-inbox/ports.js';

/** The accounts allowed as argo, per fleet, held in memory. */
export function memoryArgoAccounts(): ArgoAccounts & { held: Map<FleetId, Map<string, ArgoAccount>> } {
  const held = new Map<FleetId, Map<string, ArgoAccount>>();
  return {
    held,
    keep: (fleetId, account) => {
      held.set(fleetId, new Map(held.get(fleetId)).set(account.accountId, account));
      return Promise.resolve();
    },
    drop: (fleetId, accountId) => {
      held.get(fleetId)?.delete(accountId);
      return Promise.resolve();
    },
    list: (fleetId) => Promise.resolve([...(held.get(fleetId)?.values() ?? [])]),
  };
}
