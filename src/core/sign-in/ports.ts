/**
 * A person signs in to the gateway through pagasae, the one identity
 * provider (decision 0054): the gateway is its OpenID Connect client, and
 * the person acts in the fleet as their account, by its account token.
 */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/** A person's sign-in at pagasae under way: the client's authorization request, with the gateway's PKCE verifier. */
export interface PendingSignIn {
  readonly verifier: string;
  /** The secret the browser that started the sign-in holds, so no other browser finishes it (login CSRF). */
  readonly browserSecret: string;
  readonly request: Readonly<Record<string, string | undefined>>;
  /** What the person picked the client to act as: their account, or a party they ask access for (Q1 a). */
  readonly holder: SignInHolder;
  readonly expiresAt: Date;
}

/** What a client acts as once its person signed in: the account itself, or an outside party (decision 0056). */
export type SignInHolder = 'account' | 'party';

/**
 * Outbound port: seals a sign-in under way into the state pagasae carries
 * back, so the gateway stores nothing before it knows the fleet, and the
 * verifier stays secret on the way.
 */
export interface SignInSeals {
  seal(signIn: PendingSignIn): string;
  /** The sign-in a state seals; none for a state the gateway did not seal. */
  open(state: string): PendingSignIn | undefined;
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
  /**
   * New tokens for a refresh token, which pagasae replaces on use: refused
   * when pagasae ended the grant (disabled, signed out, no right left, the
   * token used twice), unavailable when it did not answer.
   */
  refresh(refreshToken: string): Promise<Result<PagasaeTokens, { kind: 'refused' | 'unavailable'; reason: string }>>;
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
  find(fleetId: FleetId, grantId: string): Promise<AccountGrant | undefined>;
  /** Keeps pagasae's new tokens for the grant, and the person ship they name. */
  renew(grant: { fleetId: FleetId; grantId: string }, tokens: Partial<Pick<AccountGrant, 'refreshToken' | 'accountToken' | 'accountTokenExpiresAt' | 'personShipId'>>): Promise<void>;
  end(fleetId: FleetId, grantId: string): Promise<void>;
}
