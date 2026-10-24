import type { FleetId } from '@aeolus-fleet/common';

import type { AccountGrants, Pagasae } from '../sign-in/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import { ACCESS_TOKEN_LIFETIME_MS, type ExchangeToken, type IssuedPair, type TokenRequest } from './exchange-token.js';
import type { IssuedTokens, OAuthClients, OAuthError, OAuthErrorCode, OAuthSecrets } from './ports.js';

const MS_PER_SECOND = 1000;

/** What a client is told when pagasae refuses its ID-JAG: the one refusal it can act on is D9's. */
const REFUSED_ID_JAG = 'The ID-JAG was refused. ID-JAG is only available for accounts in one fleet: an account in several signs in at the gateway’s address to choose one';

function refusal(error: OAuthErrorCode, description: string): Result<IssuedPair, OAuthError> {
  return err({ error, description });
}

/**
 * Use case: a registered client posts the ID-JAG its person's company
 * identity provider issued for the gateway, with the JWT bearer grant (RFC
 * 7523; aeolus-fleet company sign-in design, slice 6, D7, flow 3.2). The
 * gateway federates only through pagasae (decision 0054): it hands the
 * ID-JAG over, and pagasae answers the account's grant in its one fleet,
 * which must be the client's. The grant is kept as after a browser sign-in,
 * and the client gets an access token acting as the account, with no refresh
 * token: when it ends, the client asks its identity provider for a new
 * ID-JAG. Only a client registered for the code flow, with its secret if it
 * has one, posts one; there is no dynamic registration.
 */
export function createExchangeIdJag(deps: {
  clients: OAuthClients;
  tokens: IssuedTokens;
  secrets: OAuthSecrets;
  clock: Clock;
  resource: string;
  pagasae: Pick<Pagasae, 'exchangeIdJag'>;
  grants: Pick<AccountGrants, 'save'>;
  /** Whether the gateway serves the fleet: connected to it, and switched on where an installation switches fleets (decision 0021). */
  servesFleet: (fleetId: FleetId) => Promise<boolean>;
}): ExchangeToken {
  return async (request: TokenRequest) => {
    const client = request.client_id === undefined ? undefined : await deps.clients.find(request.client_id);
    const isAuthentic = client !== undefined && (client.secretHash === null ? request.client_secret === undefined : request.client_secret !== undefined && deps.secrets.hashOf(request.client_secret) === client.secretHash);
    if (client === undefined || !isAuthentic) {
      return refusal('invalid_client', 'The client could not be authenticated: an ID-JAG needs a registered client');
    }
    if (client.grant !== 'authorizationCode') {
      return refusal('unauthorized_client', 'This client signs in by client credentials');
    }
    if (request.assertion === undefined || request.assertion === '') {
      return refusal('invalid_request', 'The ID-JAG is required as the assertion');
    }
    if (request.resource !== undefined && request.resource !== deps.resource) {
      return refusal('invalid_target', `The resource must be ${deps.resource}`);
    }
    const handed = await deps.pagasae.exchangeIdJag({ idJag: request.assertion, clientId: client.clientId });
    if (!handed.isOk) {
      return handed.error.kind === 'unavailable' ? refusal('temporarily_unavailable', 'pagasae did not answer; try again') : refusal('invalid_grant', REFUSED_ID_JAG);
    }
    const { fleetId, accountId, personShipId, scopes, refreshToken, accountToken, accountTokenExpiresAt } = handed.value;
    if (fleetId !== client.fleetId || !(await deps.servesFleet(fleetId))) {
      return refusal('invalid_grant', `The account's fleet is not ${client.name}'s`);
    }
    const grantId = deps.secrets.newSecret();
    await deps.grants.save({ grantId, fleetId, accountId, personShipId, scopes, refreshToken, accountToken, accountTokenExpiresAt });
    const accessToken = deps.secrets.newSecret();
    const accessHash = deps.secrets.hashOf(accessToken);
    await deps.tokens.save({
      familyId: accessHash,
      codeHash: null,
      fleetId,
      clientId: client.clientId,
      resource: deps.resource,
      scope: null,
      kind: 'account',
      grantId,
      accessHash,
      accessExpiresAt: new Date(deps.clock.now().getTime() + ACCESS_TOKEN_LIFETIME_MS),
      refreshHash: null,
      refreshExpiresAt: null,
    });
    return ok({ accessToken, refreshToken: null, expiresInSeconds: ACCESS_TOKEN_LIFETIME_MS / MS_PER_SECOND, scope: null });
  };
}
