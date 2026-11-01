/**
 * What an item's row in Bridge does in place, beside Open (Bridge mockups,
 * home; aeolus-fleet#1535): a question still new puts its asker's pick in
 * the basket; a step leads to its link, shown with its host; the gateway's
 * own step (CC14) is its own action, in the gateway's words, where the
 * gateway finishes it.
 */
import type { ShipId } from '@aeolus-fleet/common';

import type { ItemJob } from './item-job.js';
import type { ItemState } from './item-state.js';
import type { Stale } from './stale-item.js';

export type ActInPlace =
  | { readonly kind: 'putPick'; readonly option: number }
  | { readonly kind: 'openLink'; readonly href: string; readonly host: string }
  | { readonly kind: 'ownStep'; readonly href: string; readonly label: string };

/** The gateway's own words for the action of a step of its own, by the step's link; none where it has none, and the step's title says it. */
export type OwnStepActionOf = (href: string) => string | undefined;

/** The party a step of the gateway's own asks the person to sign in to, by the step's link; none for any other step. */
export type OwnStepPartyOf = (href: string) => string | undefined;

/** What a row knows of its item to act on it in place. */
export interface ActingItem {
  readonly job: ItemJob;
  readonly state: ItemState;
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
export function actInPlaceOf(item: ActingItem, own: { gatewayShipId: ShipId | undefined; actionOf: OwnStepActionOf }): ActInPlace | null {
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
      return item.senderShipId === own.gatewayShipId ? { kind: 'ownStep', href, label: own.actionOf(href) ?? item.title } : { kind: 'openLink', href, host };
    }
    case 'stay-aware':
    case 'everything-else':
      return null;
  }
}
