import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { EmailChannels, WebPushSubscriptions } from './ports.js';

/** A browser a person turned web push on in, as the overview lists it: gone once its push service ended the subscription. */
export interface WebPushBrowser {
  readonly endpoint: string;
  readonly browser: string;
  readonly addedAt: Date;
  readonly isGone: boolean;
}

/**
 * The channels that wake a person, as their overview shows them: email
 * offered or not, and on or not; web push with the gateway's public push
 * key a browser subscribes with, none where it is not offered, and the
 * browsers they turned it on in.
 */
export interface WakeChannels {
  readonly email: { readonly isOffered: boolean; readonly isOn: boolean };
  readonly webPush: { readonly publicKey: string | null; readonly browsers: readonly WebPushBrowser[] };
}

export type ReadWakeChannels = (caller: PersonCaller) => Promise<Result<WakeChannels, PersonCrewError>>;

/**
 * Use case: the channels that wake a person when something waits for their
 * person ship (wake a person, W8). Email is offered only where the gateway
 * can ask pagasae to send it, web push only where it holds push keys;
 * nothing is on by default. A browser's keys are never shown.
 */
export function createReadWakeChannels(deps: {
  crewPersonShip: CrewPersonShip;
  emailChannels: EmailChannels;
  isEmailOffered: boolean;
  subscriptions: WebPushSubscriptions;
  /** The gateway's public push key; none where it holds no push keys. */
  webPushKey: string | null;
}): ReadWakeChannels {
  return async (caller) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const ship = { fleetId: caller.fleetId, shipId: crew.value.shipId };
    const isOn = deps.isEmailOffered && (await deps.emailChannels.isOn(ship));
    const browsers =
      deps.webPushKey === null ? [] : (await deps.subscriptions.list(ship.fleetId, ship.shipId)).map(({ endpoint, browser, addedAt, goneAt }) => ({ endpoint, browser, addedAt, isGone: goneAt !== null }));
    return ok({ email: { isOffered: deps.isEmailOffered, isOn }, webPush: { publicKey: deps.webPushKey, browsers } });
  };
}
