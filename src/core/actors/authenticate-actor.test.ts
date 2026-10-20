import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_TOKENS, fakePagasae, fakePageSessions, memoryAccountGrants, PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { memoryIssuedTokens } from '../../../test/support/oauth-fakes.js';
import type { FleetDoor } from '../connection/ports.js';
import type { AuthenticateOperator } from '../operator/authenticate-operator.js';
import { err, ok } from '../shared/result.js';
import { createAccountTokenOf } from '../sign-in/account-token.js';
import { createAuthenticateActor } from './authenticate-actor.js';

// Who calls the gateway's API (decision 0057): an account by the page
// session it signed in to the pages with, argo or a viewer by the console
// session cookie, or any ship by its own crew token, each with the scopes
// the fleet or pagasae holds for it, never what the request says.

const AGENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9agt';
const GATEWAY_CREW = 'aeolus_ct_v1_gateway';
const AGENT_CREW = 'aeolus_ct_v1_agent';

const operator: AuthenticateOperator = (cookie) =>
  Promise.resolve(
    cookie === 'aeolus_session=argo'
      ? ok({ fleetId: FLEET_ID, kind: 'operator' as const, scopes: ['fleet:read', 'fleet:manage'] })
      : err({ kind: 'NOT_THE_OPERATOR' as const, message: 'Sign in to the console of your fleet' }),
  );

let connections: ReturnType<typeof memoryConnectionStore>;
let agentFleet: typeof FLEET_ID;
/** Who read the agent's scopes, by crew token. */
let readers: string[];
/** Whether the agent is outside the gateway's own read reach, as in a fleet that applies its own network rules. */
let isOutsideGatewayReach: boolean;
let grants: ReturnType<typeof memoryAccountGrants>;
let sessions: ReturnType<typeof fakePageSessions>;
/** The page session cookie of Charlotte's grant. */
let charlotte: string;

const door: Pick<FleetDoor, 'whoami' | 'getShip'> = {
  whoami: (crewToken) =>
    Promise.resolve(crewToken === AGENT_CREW ? ok({ shipId: AGENT, fleetId: agentFleet, name: 'approver', type: 'agent' }) : err({ code: 'UNAUTHORIZED', message: 'Unknown crew token' })),
  getShip: (crewToken, { shipId, onBehalfOf }) => {
    readers.push(crewToken);
    if (shipId !== AGENT) {
      return Promise.resolve(err({ code: 'NOT_FOUND', message: 'No such ship' }));
    }
    // A read on behalf of a ship answers with that ship's read reach, which holds the ship itself (decision 0034).
    const isInReach = !isOutsideGatewayReach || onBehalfOf === AGENT;
    return Promise.resolve(isInReach ? ok({ status: 'crewed' as const, scopes: ['messages:send', 'gateway:approve'] }) : err({ code: 'FORBIDDEN', message: 'The ship is outside your read reach' }));
  },
};

beforeEach(async () => {
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: GATEWAY_CREW, crewedAt: new Date('2026-10-20T09:00:00.000Z') });
  agentFleet = FLEET_ID;
  readers = [];
  isOutsideGatewayReach = false;
  grants = memoryAccountGrants();
  sessions = fakePageSessions();
  await grants.save({ grantId: 'grant-1', fleetId: FLEET_ID, accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID, scopes: ['fleet:read', 'gateway:approve'], refreshToken: 'pagasae-refresh-1', accountToken: 'account-token-1', accountTokenExpiresAt: new Date('2026-10-20T10:00:00.000Z') });
  charlotte = `aeolus_gateway_session=${sessions.seal({ fleetId: FLEET_ID, grantId: 'grant-1' })}`;
});

function authenticate(sent: { cookie?: string; crewToken?: string }) {
  const accountTokenOf = createAccountTokenOf({ grants, tokens: memoryIssuedTokens(), pagasae: fakePagasae({ code: 'unused', verifier: 'unused', tokens: CHARLOTTE_TOKENS }), clock: { now: () => new Date('2026-10-20T09:00:00.000Z') } });
  return createAuthenticateActor({ authenticateOperator: operator, door, connections, sessions, accountTokenOf })(sent);
}

describe('who calls the gateway', () => {
  it('is argo by the console session, with its scopes', async () => {
    await expect(authenticate({ cookie: 'aeolus_session=argo' })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, kind: 'operator', scopes: ['fleet:read', 'fleet:manage'] } });
  });

  it("is a ship by its own crew token, in its fleet, with the scopes the fleet holds for it, read as the gateway's ship", async () => {
    await expect(authenticate({ crewToken: AGENT_CREW })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, kind: 'ship', shipId: AGENT, scopes: ['messages:send', 'gateway:approve'] } });
    expect(readers).toEqual([GATEWAY_CREW]);
  });

  it("is a ship outside the gateway's own read reach, its scopes read on its own behalf: an actor reads itself", async () => {
    isOutsideGatewayReach = true;

    await expect(authenticate({ crewToken: AGENT_CREW })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, kind: 'ship', shipId: AGENT, scopes: ['messages:send', 'gateway:approve'] } });
  });

  it('takes the crew token over a cookie sent with it', async () => {
    await expect(authenticate({ cookie: 'aeolus_session=argo', crewToken: AGENT_CREW })).resolves.toMatchObject({ isOk: true, value: { kind: 'ship' } });
  });

  it('refuses a crew token the fleet does not know', async () => {
    await expect(authenticate({ crewToken: 'aeolus_ct_v1_forged' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_ACTOR' } });
  });

  it('refuses a ship of a fleet the gateway is not connected to, reading nothing of it', async () => {
    agentFleet = OTHER_FLEET_ID;

    await expect(authenticate({ crewToken: AGENT_CREW })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_ACTOR' } });
    expect(readers).toEqual([]);
  });

  it('is an account by its page session, with the scopes its account token carries and the grant to act as it', async () => {
    await expect(authenticate({ cookie: `theme=dark; ${charlotte}` })).resolves.toEqual({
      isOk: true,
      value: { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID, grantId: 'grant-1', scopes: ['fleet:read', 'gateway:approve'] },
    });
  });

  it('takes the page session over a console session sent with it, and a crew token over both', async () => {
    await expect(Promise.all([authenticate({ cookie: `aeolus_session=argo; ${charlotte}` }), authenticate({ cookie: charlotte, crewToken: AGENT_CREW })])).resolves.toMatchObject([
      { isOk: true, value: { kind: 'account' } },
      { isOk: true, value: { kind: 'ship' } },
    ]);
  });

  it('refuses a page session whose sign-in ended', async () => {
    await grants.end(FLEET_ID, 'grant-1');

    await expect(authenticate({ cookie: charlotte })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_ACTOR' } });
  });

  it('refuses a caller with neither, or with a session that is no console session', async () => {
    await expect(Promise.all([authenticate({}), authenticate({ cookie: 'aeolus_session=other' })])).resolves.toMatchObject([
      { isOk: false, error: { kind: 'NOT_AN_ACTOR' } },
      { isOk: false, error: { kind: 'NOT_AN_ACTOR' } },
    ]);
  });
});
