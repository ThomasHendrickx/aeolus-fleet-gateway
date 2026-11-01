import type { DeliveryState, ShipId } from '@aeolus-fleet/common';

import { TITLE_MAX_LENGTH } from '../people/inbox-entry.js';
import type { ArgoInboxEntry, ArgoMessage } from './ports.js';

/** A message that left argo's open inbox: its title, when, and who did it: the ship, and the account signed in to the console as argo, if any. */
export interface DoneAtArgo {
  readonly title: string;
  readonly at: Date;
  readonly byShipId: ShipId | null;
  readonly signedInAccountId: string | null;
}

/**
 * argo's inbox as the gateway's ship reads it in a fleet:
 * - read: every message open there, oldest first, and the newest the ship saw done while following, if any;
 * - notLetRead: argo has not added the read rule that lets the ship read it, or removed it.
 */
export type ArgoInbox = { readonly kind: 'read'; readonly messages: readonly ArgoMessage[]; readonly lastDone: DoneAtArgo | null } | { readonly kind: 'notLetRead' };

/** A message's title as an inbox lists it: its headline, else its first line, cut to the longest title. */
export function argoTitleOf({ headline, payload }: Pick<ArgoInboxEntry, 'headline' | 'payload'>): string {
  const title = headline ?? payload.split('\n', 1)[0] ?? '';
  return title.length > TITLE_MAX_LENGTH ? `${title.slice(0, TITLE_MAX_LENGTH - 1)}…` : title;
}

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
