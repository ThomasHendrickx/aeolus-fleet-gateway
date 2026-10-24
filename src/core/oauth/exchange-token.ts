import type { FleetId } from '@aeolus-fleet/common';

import type { PartyStore } from '../parties/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import { holderOf } from './authenticate-access-token.js';
import type { AuthorizationCodes, IssuedTokens, OAuthClients, OAuthError, OAuthErrorCode, OAuthSecrets, TokenHolder, TokenPair } from './ports.js';

/** An access token works one hour; its refresh token 30 days (orchestrator-1 on aeolus-fleet#877, Q13). */
export const ACCESS_TOKEN_LIFETIME_MS = 60 * 60_000;
export const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60_000;

/** The JWT bearer grant (RFC 7523), with which a client posts an ID-JAG. */
export const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/** The tokens a client gets: no refresh token for one signed in by client credentials, which asks again. */
export interface IssuedPair {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresInSeconds: number;
  readonly scope: string | null;
}

/** A token request's parameters, the client's credentials among them, however it sent them. */
export type TokenRequest = Readonly<Record<string, string | undefined>>;

export type ExchangeToken = (request: TokenRequest) => Promise<Result<IssuedPair, OAuthError>>;

const MS_PER_SECOND = 1000;

function refusal(error: OAuthErrorCode, description: string) {
  return err({ error, description });
}

interface ExchangeTokenDeps {
  clients: OAuthClients;
  codes: AuthorizationCodes;
  tokens: IssuedTokens;
  secrets: OAuthSecrets;
  clock: Clock;
  resource: string;
  /** The parties argo's approvers added: a client signed in by client credentials is one. */
  parties: Pick<PartyStore, 'findByClient'>;
  /** Whether the fleet's outside parties are on (interop I-3). */
  servesOutsideParties: (fleetId: FleetId) => Promise<boolean>;
  /** A client's ID-JAG, the JWT bearer grant (company sign-in design, slice 6); absent where nobody signs in through pagasae. */
  exchangeIdJag?: ExchangeToken;
}

/**
 * Use case: a client takes its code for tokens, or refreshes them (OAuth
 * 2.1). A confidential client proves its secret; a public one, or one known
 * by its metadata document, needs none, as PKCE binds the code to it. A code
 * is taken once: a second try revokes every token it gave. A refresh token
 * is taken once too: the pair rotates, and a rotated one coming again
 * revokes its whole family. A client party with no human at the authorize
 * step signs in by its client credentials alone (vendor platforms V4): an
 * access token for its party, and no refresh token, as it asks again.
 */
export function createExchangeToken(deps: ExchangeTokenDeps): ExchangeToken {
  /** The client is who it says, as far as it has a secret. */
  const isAuthenticated = async (request: TokenRequest): Promise<boolean> => {
    const clientId = request.client_id;
    if (clientId === undefined) {
      return false;
    }
    const secretHash = (await deps.clients.find(clientId))?.secretHash ?? null;
    if (secretHash === null) {
      return request.client_secret === undefined;
    }
    return request.client_secret !== undefined && deps.secrets.hashOf(request.client_secret) === secretHash;
  };

  const issue = async (from: Pick<TokenPair, 'familyId' | 'codeHash' | 'fleetId' | 'clientId' | 'resource' | 'scope'> & TokenHolder): Promise<IssuedPair> => {
    const accessToken = deps.secrets.newSecret();
    const refreshToken = deps.secrets.newSecret();
    const now = deps.clock.now().getTime();
    await deps.tokens.save({
      ...from,
      accessHash: deps.secrets.hashOf(accessToken),
      accessExpiresAt: new Date(now + ACCESS_TOKEN_LIFETIME_MS),
      refreshHash: deps.secrets.hashOf(refreshToken),
      refreshExpiresAt: new Date(now + REFRESH_TOKEN_LIFETIME_MS),
    });
    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_LIFETIME_MS / MS_PER_SECOND, scope: from.scope };
  };

  const fromClientCredentials = async (request: TokenRequest): Promise<Result<IssuedPair, OAuthError>> => {
    const client = request.client_id === undefined ? undefined : await deps.clients.find(request.client_id);
    const isAuthentic = client?.secretHash != null && request.client_secret !== undefined && deps.secrets.hashOf(request.client_secret) === client.secretHash;
    if (client === undefined || !isAuthentic) {
      return refusal('invalid_client', 'The client could not be authenticated');
    }
    if (client.grant !== 'clientCredentials') {
      return refusal('unauthorized_client', 'This client signs in by authorization code');
    }
    const party = await deps.parties.findByClient(client.fleetId, client.clientId);
    if (party === undefined) {
      return refusal('invalid_client', 'The client could not be authenticated');
    }
    if (!(await deps.servesOutsideParties(client.fleetId))) {
      return refusal('unauthorized_client', "This fleet's outside parties are off");
    }
    if (request.resource !== deps.resource) {
      return refusal('invalid_target', `The resource must be ${deps.resource}`);
    }
    const accessToken = deps.secrets.newSecret();
    const accessHash = deps.secrets.hashOf(accessToken);
    await deps.tokens.save({
      familyId: accessHash,
      codeHash: null,
      fleetId: client.fleetId,
      clientId: client.clientId,
      resource: deps.resource,
      scope: null,
      kind: 'party',
      party: party.name,
      accessHash,
      accessExpiresAt: new Date(deps.clock.now().getTime() + ACCESS_TOKEN_LIFETIME_MS),
      refreshHash: null,
      refreshExpiresAt: null,
    });
    return ok({ accessToken, refreshToken: null, expiresInSeconds: ACCESS_TOKEN_LIFETIME_MS / MS_PER_SECOND, scope: null });
  };

  const fromCode = async (request: TokenRequest): Promise<Result<IssuedPair, OAuthError>> => {
    const { code, code_verifier: verifier } = request;
    if (code === undefined || verifier === undefined) {
      return refusal('invalid_request', 'A code and its PKCE verifier are required');
    }
    if (request.resource !== undefined && request.resource !== deps.resource) {
      return refusal('invalid_target', `The resource must be ${deps.resource}`);
    }
    const taken = await deps.codes.take(deps.secrets.hashOf(code));
    if (!taken) {
      return refusal('invalid_grant', 'No such code');
    }
    if (taken.wasUsed) {
      await deps.tokens.revokeIssuedBy(taken.code.codeHash);
      return refusal('invalid_grant', 'The code was used before; the tokens it gave are revoked');
    }
    const issued = taken.code;
    const isValid =
      issued.expiresAt.getTime() > deps.clock.now().getTime() &&
      issued.clientId === request.client_id &&
      issued.redirectUri === request.redirect_uri &&
      deps.secrets.challengeOf(verifier) === issued.codeChallenge;
    if (!isValid) {
      return refusal('invalid_grant', 'The code is expired, or was issued to another client, redirect URI or verifier');
    }
    const { codeHash, fleetId, clientId, resource, scope } = issued;
    return ok(await issue({ familyId: codeHash, codeHash, fleetId, clientId, resource, scope, ...holderOf(issued) }));
  };

  const fromRefreshToken = async (request: TokenRequest): Promise<Result<IssuedPair, OAuthError>> => {
    if (request.refresh_token === undefined) {
      return refusal('invalid_request', 'A refresh token is required');
    }
    const refreshHash = deps.secrets.hashOf(request.refresh_token);
    const pair = await deps.tokens.findByRefresh(refreshHash);
    if (!pair || pair.clientId !== request.client_id || pair.refreshExpiresAt === null || pair.refreshExpiresAt.getTime() <= deps.clock.now().getTime() || pair.state === 'revoked') {
      return refusal('invalid_grant', 'No such refresh token for this client, or it expired');
    }
    if (!(await deps.tokens.rotate(refreshHash))) {
      await deps.tokens.revokeFamily(pair.familyId);
      return refusal('invalid_grant', 'The refresh token was used before; its tokens are revoked');
    }
    const { familyId, codeHash, fleetId, clientId, resource, scope } = pair;
    return ok(await issue({ familyId, codeHash, fleetId, clientId, resource, scope, ...holderOf(pair) }));
  };

  return async (request) => {
    const grantType = request.grant_type;
    if (grantType === 'client_credentials') {
      return fromClientCredentials(request);
    }
    if (grantType === JWT_BEARER_GRANT && deps.exchangeIdJag !== undefined) {
      return deps.exchangeIdJag(request);
    }
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
      return refusal('unsupported_grant_type', 'Only authorization_code, refresh_token, client_credentials and, where people sign in, the JWT bearer grant are served');
    }
    if (!(await isAuthenticated(request))) {
      return refusal('invalid_client', 'The client could not be authenticated');
    }
    return grantType === 'authorization_code' ? fromCode(request) : fromRefreshToken(request);
  };
}
