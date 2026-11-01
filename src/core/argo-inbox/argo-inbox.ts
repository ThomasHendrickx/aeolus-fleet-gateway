import type { DeliveryState } from '@aeolus-fleet/common';

import type { ArgoMessage } from './ports.js';

/**
 * argo's inbox as the gateway's ship reads it in a fleet:
 * - read: every message open there, oldest first;
 * - notLetRead: argo has not added the read rule that lets the ship read it, or removed it.
 */
export type ArgoInbox = { readonly kind: 'read'; readonly messages: readonly ArgoMessage[] } | { readonly kind: 'notLetRead' };

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
