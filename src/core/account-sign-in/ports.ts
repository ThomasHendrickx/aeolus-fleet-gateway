/**
 * The account sign-in every Aeolus app shares (aeolus-fleet's header design,
 * H5): pagasae keeps one sign-in per browser in its own cookie on the domain
 * the apps share, and the gateway's pages, an app in pagasae's APP_CLIENTS,
 * exchange it server to server for the account token of the fleet in view.
 * The gateway keeps no grant for it: every token is that one exchange.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/** The cookie pagasae keeps the shared sign-in in, on the domain every Aeolus app shares. */
export const SHARED_SIGN_IN_COOKIE = 'aeolus_account_session';

/** A sign-in to the gateway's pages under way at pagasae: its PKCE verifier, the browser's secret and the page to go back to. */
export interface AccountSignInUnderWay {
  readonly verifier: string;
  /** The secret the browser that started the sign-in holds, so no other browser finishes it (login CSRF). */
  readonly browserSecret: string;
  /** The gateway's own path the browser goes back to once signed in. */
  readonly returnTo: string;
  readonly expiresAt: Date;
}

/** Outbound port: seals a sign-in under way into the state pagasae carries back, so the gateway stores nothing for it. */
export interface AccountSignInSeals {
  seal(signIn: AccountSignInUnderWay): string;
  /** The sign-in a state seals; none for a state the gateway did not seal. */
  open(state: string): AccountSignInUnderWay | undefined;
}

/** The account token pagasae exchanged the shared sign-in for, and what it names. */
export interface SharedAccountToken {
  readonly accountToken: string;
  readonly endsAt: Date;
  readonly accountId: string;
  /** The account's person ship in the fleet, if it has one (decision 0052). */
  readonly personShipId: ShipId | null;
  readonly scopes: readonly string[];
}

/** An Aeolus app an account may open, and its address (header design H1). */
export interface OpenableApp {
  readonly app: string;
  readonly url: string;
}

/** What the account may open (header design H1): the account, its apps beside the fleets, and per fleet its name and the apps it may open there. */
export interface OpenableApps {
  readonly account: { readonly id: string; readonly email: string };
  readonly apps: readonly OpenableApp[];
  readonly fleets: readonly { readonly fleetId: FleetId; readonly name: string; readonly apps: readonly OpenableApp[] }[];
}

/**
 * Why there is no account token: the shared sign-in ended or never was
 * (signedOut), the account holds no right in that fleet (noRights), or
 * pagasae did not answer (unavailable).
 */
export type SharedSignInRefusal = { readonly kind: 'signedOut' } | { readonly kind: 'noRights' } | { readonly kind: 'unavailable' };

/** Outbound port: pagasae, for the gateway's pages as one of its apps. */
export interface SharedSignIn {
  /** pagasae's authorize address for the gateway's pages, with the state and the PKCE challenge, naming no fleet. */
  authorizeUrl(signIn: { state: string; codeChallenge: string }): string;
  /** Redeems the code pagasae sent the browser back with; its answer names the account, and the shared sign-in is then the browser's. */
  redeemCode(code: { code: string; verifier: string }): Promise<Result<void, { reason: string }>>;
  /** The account token of the fleet for the shared sign-in, fresh at every call. */
  accountToken(asked: { signIn: string; fleetId: FleetId }): Promise<Result<SharedAccountToken, SharedSignInRefusal>>;
  apps(signIn: string): Promise<Result<OpenableApps, { kind: 'signedOut' | 'unavailable' }>>;
  /** Ends the shared sign-in, in every app at once. */
  revoke(signIn: string): Promise<Result<void, { kind: 'unavailable' }>>;
}
