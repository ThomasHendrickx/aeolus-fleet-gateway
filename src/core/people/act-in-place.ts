/**
 * What an item's row in Bridge does in place, beside Open (Bridge mockups,
 * home; aeolus-fleet#1535): a question still new puts its asker's pick in
 * the basket; a step leads to its link, shown with its host; the gateway's
 * own step (CC14) is its own action, where the gateway finishes it.
 */
import type { ShipId } from '@aeolus-fleet/common';

import type { ItemJob } from './item-job.js';
import type { ItemState } from './item-state.js';
import type { Stale } from './stale-item.js';

export type ActInPlace =
  | { readonly kind: 'putPick'; readonly option: number }
  | { readonly kind: 'openLink'; readonly href: string; readonly host: string }
  | { readonly kind: 'ownStep'; readonly href: string; readonly title: string };

/** What a row knows of its item to act on it in place. */
export interface ActingItem {
  readonly job: ItemJob;
  readonly state: Exclude<ItemState, 'done'>;
  readonly stale: Stale | null;
  readonly senderShipId: ShipId;
  readonly title: string;
  readonly pick: number | null;
  readonly stepLink: string | null;
}

/** The host a link leads to; none for one that does not read as a URL. */
function hostOf(href: string): string | undefined {
  return URL.canParse(href) ? new URL(href).host : undefined;
}

/** What the row does in place; nothing for a question opened, a question or step stale, a step without a link, or any other item. */
export function actInPlaceOf(item: ActingItem, gatewayShipId: ShipId | undefined): ActInPlace | null {
  switch (item.job) {
    case 'decide':
      return item.state === 'new' && item.stale === null && item.pick !== null ? { kind: 'putPick', option: item.pick } : null;
    case 'do': {
      if (item.stale !== null) {
        return null;
      }
      const href = item.stepLink;
      const host = href === null ? undefined : hostOf(href);
      if (href === null || host === undefined) {
        return null;
      }
      return item.senderShipId === gatewayShipId ? { kind: 'ownStep', href, title: item.title } : { kind: 'openLink', href, host };
    }
    case 'stay-aware':
    case 'everything-else':
      return null;
  }
}
