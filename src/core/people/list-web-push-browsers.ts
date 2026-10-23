import type { PersonShip, WebPushSubscriptions } from './ports.js';

/** A browser a person turned web push on in, as the overview lists it: gone once its push service ended the subscription. */
export interface WebPushBrowser {
  readonly endpoint: string;
  readonly browser: string;
  readonly addedAt: Date;
  readonly isGone: boolean;
}

export type ListWebPushBrowsers = (ship: PersonShip) => Promise<WebPushBrowser[]>;

/** Use case: the browsers a person turned web push on in, oldest first, never their keys (wake a person, W8). */
export function createListWebPushBrowsers(deps: { subscriptions: WebPushSubscriptions }): ListWebPushBrowsers {
  return async ({ fleetId, shipId }) =>
    (await deps.subscriptions.list(fleetId, shipId)).map(({ endpoint, browser, addedAt, goneAt }) => ({ endpoint, browser, addedAt, isGone: goneAt !== null }));
}
