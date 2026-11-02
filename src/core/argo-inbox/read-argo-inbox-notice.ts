import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { FollowArgoInbox } from './follow-argo-inbox.js';
import type { ArgoAccounts } from './ports.js';

/**
 * What the gateway's overview tells an account of argo's inbox: nothing, or
 * that argo has not let the gateway's ship read it, naming that ship, which
 * the read rule argo adds lets read argo.
 */
export type ArgoInboxNotice = { readonly kind: 'none' } | { readonly kind: 'notLetRead'; readonly gatewayShip: { readonly shipId: ShipId; readonly name: string } };

export type ReadArgoInboxNotice = (caller: { fleetId: FleetId; accountId: string }) => Promise<ArgoInboxNotice>;

/**
 * Use case: while argo has not added the read rule, or removed it, nothing
 * of argo's reaches the people allowed as argo, so the gateway's overview
 * tells an account allowed as argo so, and where argo adds the rule (argo's
 * inbox, section 4). Any other account, and any fleet whose inbox the
 * gateway reads or has not asked about yet, is told nothing.
 */
export function createReadArgoInboxNotice(deps: { accounts: Pick<ArgoAccounts, 'list'>; inboxOf: FollowArgoInbox['inboxOf']; connections: Pick<ConnectionStore, 'find'> }): ReadArgoInboxNotice {
  return async ({ fleetId, accountId }) => {
    if (deps.inboxOf(fleetId)?.kind !== 'notLetRead') {
      return { kind: 'none' };
    }
    const [accounts, gateway] = await Promise.all([deps.accounts.list(fleetId), deps.connections.find(fleetId)]);
    if (gateway === undefined || !accounts.some((account) => account.accountId === accountId)) {
      return { kind: 'none' };
    }
    return { kind: 'notLetRead', gatewayShip: { shipId: gateway.shipId, name: gateway.name } };
  };
}
