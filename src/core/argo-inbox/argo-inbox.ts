import type { DeliveryState, ShipId } from '@aeolus-fleet/common';

import type { ArgoInboxChange, ArgoMessage } from './ports.js';

/**
 * argo's inbox as the gateway's ship reads it in a fleet:
 * - read: argo's ship, and every message open there, oldest first;
 * - notLetRead: argo has not added the read rule that lets the ship read it, or removed it.
 */
export type ArgoInbox = { readonly kind: 'read'; readonly argo: ShipId; readonly messages: readonly ArgoMessage[] } | { readonly kind: 'notLetRead' };

/** When a message left argo's open inbox, and the account that did it, as argo or itself; none when no account did. */
export type DoneAtArgo = Omit<ArgoInboxChange, 'messageId'>;

/** Whether a delivery to argo is open in its inbox: not done yet, as the console's Open filter keeps it. */
export function isOpenAtArgo(state: DeliveryState): boolean {
  switch (state) {
    case 'pending':
    case 'received':
    case 'handed':
      return true;
    case 'acknowledged':
    case 'handled':
    case 'notHandled':
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return false;
  }
}
