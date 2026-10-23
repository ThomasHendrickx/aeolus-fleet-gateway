import { refuse, type DomainError } from '../shared/errors.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { PersonShip, WebPushSubscriptions } from './ports.js';

/** The longest push service endpoint the gateway keeps. */
const ENDPOINT_MAX_LENGTH = 2048;

/** The longest browser name, as the page names it. */
const BROWSER_MAX_LENGTH = 100;

/** A browser's P-256 public key (65 bytes) and auth secret (16 bytes), base64url as its PushSubscription states them, padded or not. */
const P256DH = /^[A-Za-z0-9_-]{87}=?$/;
const AUTH = /^[A-Za-z0-9_-]{22}(==)?$/;

export interface WebPushTurnedOn {
  readonly ship: PersonShip;
  readonly fleetName: string;
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly browser: string;
}

export type TurnOnWebPush = (input: WebPushTurnedOn) => Promise<Result<undefined, DomainError<'INVALID_SUBSCRIPTION'>>>;

function isHttpsUrl(text: string): boolean {
  return URL.canParse(text) && new URL(text).protocol === 'https:';
}

/**
 * Use case: a person turns web push on for a browser (wake a person, W8),
 * with the subscription the browser's push service gave it: kept for their
 * person ship, a browser turned on again kept anew. A push service is
 * reached over https only.
 */
export function createTurnOnWebPush(deps: { subscriptions: WebPushSubscriptions; clock: Clock }): TurnOnWebPush {
  return async ({ ship, fleetName, endpoint, keys, browser }) => {
    if (endpoint.length > ENDPOINT_MAX_LENGTH || !isHttpsUrl(endpoint)) {
      return refuse('INVALID_SUBSCRIPTION', `The push service's endpoint must be an https URL of at most ${String(ENDPOINT_MAX_LENGTH)} characters`);
    }
    if (!P256DH.test(keys.p256dh) || !AUTH.test(keys.auth)) {
      return refuse('INVALID_SUBSCRIPTION', "The browser's push keys are not a P-256 public key and an auth secret of 16 bytes");
    }
    if (browser.length === 0 || browser.length > BROWSER_MAX_LENGTH) {
      return refuse('INVALID_SUBSCRIPTION', `The browser's name must hold 1 to ${String(BROWSER_MAX_LENGTH)} characters`);
    }
    await deps.subscriptions.save({ ...ship, endpoint, keys, browser, fleetName, addedAt: deps.clock.now(), goneAt: null });
    return ok(undefined);
  };
}
