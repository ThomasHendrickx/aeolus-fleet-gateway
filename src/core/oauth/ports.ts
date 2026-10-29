/**
 * The gateway's OAuth 2.1 authorization server for outside MCP clients
 * (interop 3.1, MCP 2026-07-28 authorization): its clients, the codes it
 * issues, the tokens it issues, and the secrets behind them.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/**
 * How a client signs in: by a code a person's approval issued, or, with no
 * human at the authorize step, by its own client credentials (vendor
 * platforms V4).
 */
export type ClientGrant = 'authorizationCode' | 'clientCredentials';

/** A client registered for its fleet. A confidential one has a secret, kept only as its hash. */
export interface OAuthClient {
  readonly clientId: string;
  readonly fleetId: FleetId;
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly secretHash: string | null;
  readonly grant: ClientGrant;
}

export interface OAuthClients {
  find(clientId: string): Promise<OAuthClient | undefined>;
  save(client: OAuthClient): Promise<void>;
}

/** Outbound port: a client's metadata document (CIMD), fetched from its client id URL, as JSON not yet read. */
export interface ClientMetadataDocuments {
  fetch(url: string): Promise<Result<unknown, { reason: string }>>;
}

/** A code argo's approval issued: used once, within its minute, by the client and redirect URI it was issued to. */
/**
 * Whom a code and the tokens it leads to stand for: a party argo approved,
 * the proxy ship its client calls the fleet as; or an account a person
 * signed in as through pagasae, by its grant (decision 0054).
 */
export type TokenHolder = { readonly kind: 'party'; readonly party: string } | { readonly kind: 'account'; readonly grantId: string };

export type AuthorizationCode = {
  readonly codeHash: string;
  readonly fleetId: FleetId;
  readonly clientId: string;
  readonly redirectUri: string;
  /** The PKCE challenge, S256. */
  readonly codeChallenge: string;
  readonly resource: string;
  readonly scope: string | null;
  readonly expiresAt: Date;
} & TokenHolder;

export interface AuthorizationCodes {
  save(code: AuthorizationCode): Promise<void>;
  /** Marks the code used, at most once even under a race: the code, and whether it had been used before. */
  take(codeHash: string): Promise<{ code: AuthorizationCode; wasUsed: boolean } | undefined>;
}

/**
 * An access token and its refresh token, issued together; a family is every
 * pair one code led to. A client signed in by client credentials gets its
 * access token alone, from no code.
 */
export type TokenPair = {
  readonly familyId: string;
  readonly codeHash: string | null;
  readonly fleetId: FleetId;
  readonly clientId: string;
  readonly resource: string;
  readonly scope: string | null;
  readonly accessHash: string;
  readonly accessExpiresAt: Date;
  readonly refreshHash: string | null;
  readonly refreshExpiresAt: Date | null;
} & TokenHolder;

export interface IssuedTokens {
  /** A new pair, active. */
  save(pair: TokenPair): Promise<void>;
  findByAccess(accessHash: string): Promise<(TokenPair & { state: TokenState }) | undefined>;
  findByRefresh(refreshHash: string): Promise<(TokenPair & { state: TokenState }) | undefined>;
  /** Marks an active pair rotated, at most once even under a race: whether this call did. */
  rotate(refreshHash: string): Promise<boolean>;
  revokeFamily(familyId: string): Promise<void>;
  revokeIssuedBy(codeHash: string): Promise<void>;
  /** Revokes every pair that stands for the account grant in the fleet: its person signs in again. */
  revokeGrant(fleetId: FleetId, grantId: string): Promise<void>;
  /** Revokes every pair that stands for the party in the fleet: its client is refused at its next call. */
  revokeParty(fleetId: FleetId, party: string): Promise<void>;
}

/** active: in use; rotated: its refresh token was traded for a new pair; revoked: refused for good. */
export type TokenState = 'active' | 'rotated' | 'revoked';

/** Outbound port: the secrets the server issues, how it keeps them, and PKCE's S256. */
export interface OAuthSecrets {
  /** A new random secret, safe in a URL. */
  newSecret(): string;
  /** The hash a secret is kept as, and looked up by. */
  hashOf(secret: string): string;
  /** PKCE S256: BASE64URL(SHA256(verifier)). */
  challengeOf(verifier: string): string;
}

/** OAuth's error codes the gateway answers (RFC 6749, RFC 8707). */
export type OAuthErrorCode = 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client' | 'unsupported_grant_type' | 'unsupported_response_type' | 'invalid_target' | 'access_denied' | 'temporarily_unavailable';

export interface OAuthError {
  readonly error: OAuthErrorCode;
  readonly description: string;
}
