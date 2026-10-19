import type { FleetId } from '@aeolus-fleet/common';

import type { ClientMetadataDocuments, FleetEndpoints, OAuthClient, OAuthClients, AuthorizationCode, AuthorizationCodes, IssuedTokens, OAuthSecrets, TokenPair } from '../../src/core/oauth/ports.js';
import { err, ok } from '../../src/core/shared/result.js';

import { FLEET_ID, OTHER_FLEET_ID } from './fleet-fakes.js';

export const ISSUER = 'http://gateway.example.com';
/** The fleet's MCP endpoint in the tests: the resource its tokens are bound to (RFC 8707). */
export const RESOURCE = `${ISSUER}/fleets/fleetaaa/mcp`;
/** Another fleet's MCP endpoint, at the same gateway. */
export const OTHER_RESOURCE = `${ISSUER}/fleets/fleetbbb/mcp`;

/** The two fleets' MCP endpoints, each at its alias. */
export function fakeFleetEndpoints(): FleetEndpoints {
  const endpoints = new Map<FleetId, string>([
    [FLEET_ID, RESOURCE],
    [OTHER_FLEET_ID, OTHER_RESOURCE],
  ]);
  return {
    fleetOf: (resource) => Promise.resolve([...endpoints].find(([, endpoint]) => endpoint === resource)?.[0]),
  };
}

/**
 * Secrets as a test reads them: numbered in the order they are drawn, each
 * hash and PKCE challenge spelled out, so a test names them as literals.
 */
export function fakeSecrets(): OAuthSecrets & { drawn: number } {
  const secrets = {
    drawn: 0,
    newSecret: () => {
      secrets.drawn += 1;
      return `secret-${String(secrets.drawn)}`;
    },
    hashOf: (secret: string) => `hash(${secret})`,
    challengeOf: (verifier: string) => `S256(${verifier})`,
  };
  return secrets;
}

export function memoryOAuthClients(): OAuthClients & { held: Map<string, OAuthClient> } {
  const held = new Map<string, OAuthClient>();
  return {
    held,
    find: (clientId) => Promise.resolve(held.get(clientId)),
    save: (client) => {
      held.set(client.clientId, client);
      return Promise.resolve();
    },
  };
}

/** The client metadata documents on the web (CIMD), by URL; any other URL does not answer. */
export function fakeClientMetadataDocuments(documents: Record<string, unknown> = {}): ClientMetadataDocuments & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve(url in documents ? ok(documents[url]) : err({ reason: 'connect ECONNREFUSED' }));
    },
  };
}

export function memoryAuthorizationCodes(): AuthorizationCodes & { held: Map<string, AuthorizationCode & { isUsed: boolean }> } {
  const held = new Map<string, AuthorizationCode & { isUsed: boolean }>();
  return {
    held,
    save: (code) => {
      held.set(code.codeHash, { ...code, isUsed: false });
      return Promise.resolve();
    },
    take: (codeHash) => {
      const code = held.get(codeHash);
      if (!code) {
        return Promise.resolve(undefined);
      }
      held.set(codeHash, { ...code, isUsed: true });
      const { isUsed, ...taken } = code;
      return Promise.resolve({ code: taken, wasUsed: isUsed });
    },
  };
}

export function memoryIssuedTokens(): IssuedTokens & { held: (TokenPair & { state: 'active' | 'rotated' | 'revoked' })[] } {
  const held: (TokenPair & { state: 'active' | 'rotated' | 'revoked' })[] = [];
  const set = (match: (pair: TokenPair) => boolean, state: 'rotated' | 'revoked') => {
    held.forEach((pair, index) => {
      if (match(pair)) {
        held[index] = { ...pair, state };
      }
    });
  };
  return {
    held,
    save: (pair) => {
      held.push({ ...pair, state: 'active' });
      return Promise.resolve();
    },
    findByAccess: (accessHash) => Promise.resolve(held.find((pair) => pair.accessHash === accessHash)),
    findByRefresh: (refreshHash) => Promise.resolve(held.find((pair) => pair.refreshHash === refreshHash)),
    rotate: (refreshHash) => {
      const pair = held.find((each) => each.refreshHash === refreshHash && each.state === 'active');
      if (pair) {
        set((each) => each.refreshHash === refreshHash, 'rotated');
      }
      return Promise.resolve(pair !== undefined);
    },
    revokeFamily: (familyId) => {
      set((pair) => pair.familyId === familyId, 'revoked');
      return Promise.resolve();
    },
    revokeIssuedBy: (codeHash) => {
      set((pair) => pair.codeHash === codeHash, 'revoked');
      return Promise.resolve();
    },
  };
}
