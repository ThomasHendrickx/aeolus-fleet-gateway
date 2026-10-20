/**
 * A person signs in to the gateway through pagasae, the one identity
 * provider (decision 0054): the gateway is its OpenID Connect client, and
 * the person acts in the fleet as their account, by its account token.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/** A person's sign-in at pagasae under way: the client's authorization request, kept by its state's hash with the gateway's PKCE verifier. */
export interface PendingSignIn {
  readonly stateHash: string;
  readonly verifier: string;
  readonly request: Readonly<Record<string, string | undefined>>;
  readonly expiresAt: Date;
}

export interface PendingSignIns {
  save(signIn: PendingSignIn): Promise<void>;
  /** Takes the sign-in away, at most once even under a race; none for an unknown state. */
  take(stateHash: string): Promise<PendingSignIn | undefined>;
}

/** What pagasae answers for a redeemed code: the account token, what it names, and the refresh token behind it. */
export interface PagasaeTokens {
  readonly accountToken: string;
  readonly accountTokenExpiresAt: Date;
  readonly refreshToken: string;
  /** The fleet pagasae signed the account token for: the one the person picked, or their only one. */
  readonly fleetId: FleetId;
  readonly accountId: string;
  /** The account's person ship in the fleet, if it has one (decision 0052). */
  readonly personShipId: ShipId | null;
}

/** Outbound port: pagasae, where the gateway sends a person to sign in, and redeems the code they come back with. */
export interface Pagasae {
  /** pagasae's authorize address for the gateway, with the state and the PKCE challenge, naming no fleet. */
  authorizeUrl(signIn: { state: string; codeChallenge: string }): string;
  redeemCode(code: { code: string; verifier: string }): Promise<Result<PagasaeTokens, { reason: string }>>;
}

/** A person's sign-in kept for their MCP client: the account in the fleet, and pagasae's tokens to act as it. */
export interface AccountGrant {
  readonly grantId: string;
  readonly fleetId: FleetId;
  readonly accountId: string;
  readonly personShipId: ShipId | null;
  readonly refreshToken: string;
  readonly accountToken: string;
  readonly accountTokenExpiresAt: Date;
}

export interface AccountGrants {
  save(grant: AccountGrant): Promise<void>;
}
