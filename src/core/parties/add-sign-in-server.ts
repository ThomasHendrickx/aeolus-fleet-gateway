import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import type { SignInClient } from '../vault/credential.js';
import type { ApproveParty, ApprovePartyRefusal } from './approve-party.js';
import type { AuthorizationServers, DiscoveredSignIn, PartyStore } from './ports.js';
import type { ShownParty } from './shown-party.js';

/** The PKCE method the gateway signs in with; an authorization server that does not state it is refused (MCP authorization). */
const PKCE_METHOD = 'S256';

/** The scopes a sign-in adds when the authorization server lists them: a refresh token, and the outside account's subject (Q8, Q13). */
const ADDED_SCOPES = ['offline_access', 'openid'];

export type AddSignInServerRefusal =
  | ApprovePartyRefusal
  | DomainError<'SERVER_UNREACHABLE' | 'NO_AUTHORIZATION_SERVER' | 'SIGN_IN_CHECK_FAILED' | 'NO_DYNAMIC_REGISTRATION' | 'REGISTRATION_REFUSED'>;

export type AddSignInServer = (input: Omit<Parameters<ApproveParty>[0], 'credential'>) => Promise<Result<ShownParty, AddSignInServerRefusal>>;

/** The outside scopes each person's sign-in asks for (Q8): the 401's, else every scope the server lists, with offline_access and openid when the authorization server lists them. */
function scopeOf(discovered: DiscoveredSignIn): string {
  const asked = discovered.challengeScope === null ? [...discovered.resourceScopes] : discovered.challengeScope.split(' ');
  const added = ADDED_SCOPES.filter((scope) => discovered.serverScopes.includes(scope) && !asked.includes(scope));
  return [...asked, ...added].join(' ');
}

/**
 * Use case: an approver adds an outside MCP server that takes only an OAuth
 * sign-in (decision 0067). The gateway finds its authorization server,
 * checks it states PKCE S256 and offers dynamic registration, registers one
 * client for the party, bound to its issuer, then approves the party with
 * that client as its credential: its proxy ship is commissioned and crewed,
 * unstated until a person signs in. A refused check keeps nothing. The same
 * addition again finds the party it kept, and registers no second client.
 */
export function createAddSignInServer(deps: {
  approveParty: ApproveParty;
  parties: PartyStore;
  servers: AuthorizationServers;
  servesOutsideParties: (fleetId: FleetId) => Promise<boolean>;
  /** Where the outside authorization server sends each person back after their sign-in. */
  redirectUri: string;
}): AddSignInServer {
  return async (input) => {
    const { operatorFleetId: fleetId, name, url, requestId } = input;
    if (!(await deps.servesOutsideParties(fleetId))) {
      return refuse('OUTSIDE_PARTIES_OFF', "This fleet's outside parties are off: turn them on first");
    }
    const earlier = await deps.parties.find(fleetId, name);
    if (earlier) {
      if (earlier.kind === 'mcpServer' && earlier.credential.kind === 'personSignIn' && earlier.requestId === requestId) {
        return deps.approveParty({ ...input, credential: earlier.credential });
      }
      return refuse('PARTY_EXISTS', `A party named ${name} was approved already`);
    }

    const discovered = await deps.servers.discover(url);
    if (!discovered.isOk) {
      switch (discovered.error.kind) {
        case 'unreachable':
          return refuse('SERVER_UNREACHABLE', `The MCP server could not be reached: ${discovered.error.reason}`);
        case 'noAuthorizationServer':
          return refuse('NO_AUTHORIZATION_SERVER', `The server states no authorization server: ${discovered.error.reason}`);
        case 'noServerMetadata':
          return refuse('SIGN_IN_CHECK_FAILED', `The authorization server failed its check: ${discovered.error.reason}`);
      }
    }
    const signIn = discovered.value;
    if (!signIn.codeChallengeMethods.includes(PKCE_METHOD)) {
      return refuse('SIGN_IN_CHECK_FAILED', `The authorization server ${signIn.issuer} does not state PKCE ${PKCE_METHOD}`);
    }
    if (signIn.registrationEndpoint === null) {
      return refuse('NO_DYNAMIC_REGISTRATION', `The authorization server ${signIn.issuer} offers no dynamic registration`);
    }
    const scope = scopeOf(signIn);
    const registered = await deps.servers.register(signIn.registrationEndpoint, { clientName: `Aeolus: ${name}`, redirectUri: deps.redirectUri, scope });
    if (!registered.isOk) {
      return refuse('REGISTRATION_REFUSED', `The authorization server ${signIn.issuer} refused the registration: ${registered.error.reason}`);
    }
    const client: SignInClient = {
      issuer: signIn.issuer,
      authorizationEndpoint: signIn.authorizationEndpoint,
      tokenEndpoint: signIn.tokenEndpoint,
      revocationEndpoint: signIn.revocationEndpoint,
      ...registered.value,
      resource: signIn.resource,
      scope,
    };
    return deps.approveParty({ ...input, credential: { kind: 'personSignIn', client } });
  };
}
