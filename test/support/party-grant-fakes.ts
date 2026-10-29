import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { McpServerParty } from '../../src/core/parties/party.js';
import type { PartyGrant } from '../../src/core/party-grants/party-grant.js';
import type { IdTokenClaims, PartyGrants, PartySignIns, PartySignInSeals, PartySignInUnderWay, RedeemedTokens, TokenRequestFailure } from '../../src/core/party-grants/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';
import type { SignInClient } from '../../src/core/vault/credential.js';
import { FLEET_ID } from './fleet-fakes.js';
import { PROXY_SHIP_ID } from './party-fakes.js';

export const MATHILDE_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9mth';
export const JORIS_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9jrs';

/** A party's sign-in client, shaped as Attio's (oauth-servers L10): no revocation, no issuer in its authorization response. */
export const ATTIO_CLIENT: SignInClient = {
  issuer: 'https://app.attio.com',
  authorizationEndpoint: 'https://app.attio.com/oidc/authorize',
  tokenEndpoint: 'https://app.attio.com/oidc/token',
  revocationEndpoint: null,
  isIssuerInResponse: false,
  clientId: 'client-1',
  clientSecret: 'secret-1',
  registrationClientUri: null,
  registrationAccessToken: null,
  resource: 'https://mcp.attio.com/mcp',
  scope: 'mcp offline_access openid',
};

/** Attio added as a party where each person signs in, its proxy ship crewed. */
export function anAttioParty(overrides: Partial<McpServerParty> = {}): McpServerParty {
  return {
    fleetId: FLEET_ID,
    name: 'attio',
    kind: 'mcpServer',
    url: 'https://mcp.attio.com/mcp',
    credential: { kind: 'personSignIn', client: ATTIO_CLIENT },
    concurrencyLimit: 4,
    state: 'crewed',
    proxyShipId: PROXY_SHIP_ID,
    secret: null,
    crewToken: 'aeolus_ct_v1_attio',
    requestId: 'a-1',
    requestHash: 'h',
    approvedAt: new Date('2026-10-28T13:00:00.000Z'),
    toolSwitches: null,
    ...overrides,
  };
}

/** Mathilde's grant of Attio, as her sign-in kept it. */
export function aPartyGrant(overrides: Partial<PartyGrant> = {}): PartyGrant {
  return {
    fleetId: FLEET_ID,
    party: 'attio',
    personShipId: MATHILDE_SHIP_ID,
    accountId: 'acc-mathilde',
    outsideAccount: { subject: 'sub-1', name: 'mathilde@acme.example' },
    accessToken: 'access-mathilde',
    refreshToken: 'refresh-mathilde',
    accessTokenEndsAt: new Date('2026-10-28T15:00:00.000Z'),
    signedInAt: new Date('2026-10-28T14:00:00.000Z'),
    lastUsedAt: null,
    ...overrides,
  };
}

/** The grants in memory: one per person and party, and one per outside account and party. */
export function memoryPartyGrants(): PartyGrants & { held: PartyGrant[] } {
  const held = new Array<PartyGrant>();
  const isOf = (grant: PartyGrant, of: { fleetId: FleetId; party: string }) => grant.fleetId === of.fleetId && grant.party === of.party;
  const usedAt = (grant: PartyGrant) => grant.lastUsedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return {
    held,
    ofPerson: (fleetId, { party, personShipId }) => Promise.resolve(held.find((grant) => isOf(grant, { fleetId, party }) && grant.personShipId === personShipId)),
    ofSubject: (fleetId, { party, subject }) => Promise.resolve(held.find((grant) => isOf(grant, { fleetId, party }) && grant.outsideAccount.subject === subject)),
    usable: (fleetId, { party, now }) =>
      Promise.resolve(
        held
          .filter((grant) => isOf(grant, { fleetId, party }) && (grant.accessTokenEndsAt === null || grant.accessTokenEndsAt > now))
          .sort((one, other) => usedAt(other) - usedAt(one) || other.signedInAt.getTime() - one.signedInAt.getTime())[0],
      ),
    keep: (grant) => {
      const { subject } = grant.outsideAccount;
      if (subject !== null && held.some((other) => isOf(other, grant) && other.personShipId !== grant.personShipId && other.outsideAccount.subject === subject)) {
        return Promise.resolve('subjectTaken');
      }
      const earlier = held.findIndex((other) => isOf(other, grant) && other.personShipId === grant.personShipId);
      if (earlier === -1) {
        held.push(grant);
      } else {
        held[earlier] = grant;
      }
      return Promise.resolve('kept');
    },
    remove: (fleetId, { party, personShipId }) => {
      const at = held.findIndex((grant) => isOf(grant, { fleetId, party }) && grant.personShipId === personShipId);
      if (at !== -1) {
        held.splice(at, 1);
      }
      return Promise.resolve();
    },
  };
}

/** Sign-ins under way as readable text: a test reads what the gateway sealed. */
export function plainPartySignInSeals(): PartySignInSeals {
  const sealedSchema = z.object({ fleetId: idSchema('fleet'), party: z.string(), accountId: z.string(), personShipId: idSchema('ship'), verifier: z.string(), expiresAt: z.coerce.date() });
  return {
    seal: (signIn) => JSON.stringify(signIn),
    open: (sealed) => {
      try {
        const opened: PartySignInUnderWay | undefined = sealedSchema.safeParse(JSON.parse(sealed)).data;
        return opened;
      } catch {
        return undefined;
      }
    },
  };
}

/** Mathilde's ID token from Attio, for the party's client. */
export const MATHILDE_ID_TOKEN: IdTokenClaims = { issuer: 'https://app.attio.com', audiences: ['client-1'], subject: 'sub-1', name: 'mathilde@acme.example' };

/** Attio's tokens for Mathilde's code, with her ID token. */
export const MATHILDE_TOKENS: RedeemedTokens = { accessToken: 'access-mathilde', refreshToken: 'refresh-mathilde', expiresInSeconds: 3600, idToken: MATHILDE_ID_TOKEN };

/** A party's authorization server in memory: each code it issued, with the tokens it redeems for, once, and each token revoked. */
export function fakePartySignIns() {
  const noFailure = (): TokenRequestFailure | undefined => undefined;
  const revoking = (): Result<void, { reason: string }> => ok(undefined);
  const state = {
    codes: new Map<string, RedeemedTokens>([['code-mathilde', MATHILDE_TOKENS]]),
    redeemed: new Array<{ clientId: string; code: string; verifier: string; redirectUri: string }>(),
    revoked: new Array<{ revocationEndpoint: string; token: string }>(),
    failure: noFailure(),
    revocation: revoking(),
  };
  const signIns: PartySignIns = {
    authorizeUrl: (client, { state: sealed, codeChallenge, redirectUri }) =>
      `${client.authorizationEndpoint}?${new URLSearchParams({ response_type: 'code', client_id: client.clientId, redirect_uri: redirectUri, scope: client.scope, state: sealed, code_challenge: codeChallenge, code_challenge_method: 'S256', resource: client.resource }).toString()}`,
    redeemCode: (client, { code, verifier, redirectUri }) => {
      if (state.failure !== undefined) {
        return Promise.resolve(err(state.failure));
      }
      state.redeemed.push({ clientId: client.clientId, code, verifier, redirectUri });
      const tokens = state.codes.get(code);
      state.codes.delete(code);
      return Promise.resolve(tokens === undefined ? err({ kind: 'refused' as const, error: 'invalid_grant', reason: 'invalid_grant: the code is unknown or used' }) : ok(tokens));
    },
    revoke: (client, token) => {
      state.revoked.push({ revocationEndpoint: client.revocationEndpoint, token });
      return Promise.resolve(state.revocation);
    },
  };
  return { state, signIns };
}
