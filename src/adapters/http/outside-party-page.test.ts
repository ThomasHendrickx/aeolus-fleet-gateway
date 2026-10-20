import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ListedParty } from '../../core/parties/shown-party.js';
import { err, ok } from '../../core/shared/result.js';
import type { Context } from '../trpc/router.js';
import { registerOutsidePartyPage } from './outside-party-page.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const MANAGER = 'aeolus_gateway_session=manager';
const READER = 'aeolus_gateway_session=reader';
const HOST = 'gateway.example.com';
const ORIGIN = `http://${HOST}`;
const OWNER = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
const LINEAR: ListedParty = {
  name: 'linear',
  kind: 'mcpServer',
  url: 'https://mcp.linear.app/mcp?a=<1>',
  credentialKind: 'bearer',
  concurrencyLimit: 4,
  state: 'crewed',
  proxyShipId: 'shp_01m3tbfspe96yf1rnr4ank9lin',
  ownerShipId: OWNER,
  scopes: ['messages:send', 'messages:receive'],
};

let server: FastifyInstance;
let parties: ListedParty[];
let retired: string[];

function contextFor(cookie: string | undefined): Context {
  const unused = () => Promise.reject(new Error('not used by the page'));
  const account = (scopes: string[]) => ok({ fleetId: FLEET, kind: 'account' as const, accountId: 'acc_1', personShipId: null, grantId: 'grt_1', scopes });
  return {
    cookie,
    crewToken: undefined,
    authenticateActor: ({ cookie: sent }) => {
      if (sent === MANAGER) {
        return Promise.resolve(account(['fleet:read', 'fleet:manage']));
      }
      if (sent === READER) {
        return Promise.resolve(account(['fleet:read']));
      }
      return Promise.resolve(err({ kind: 'NOT_AN_ACTOR' as const, message: 'Sign in first' }));
    },
    isServed: () => Promise.resolve(true),
    heldConnection: unused,
    installationTokenSent: undefined,
    installation: { mode: 'open', token: undefined },
    setFleetEnabled: unused,
    readFleet: unused,
    deleteFleet: unused,
    endSignIns: unused,
    readConnection: unused,
    connect: unused,
    approveParty: unused,
    crewParty: unused,
    listParties: () => Promise.resolve(parties),
    readParty: ({ name }) => {
      const party = parties.find((each) => each.name === name);
      return Promise.resolve(party === undefined ? err({ kind: 'NO_SUCH_PARTY' as const, message: `There is no outside party ${name}` }) : ok(party));
    },
    changePartyOwner: unused,
    changePartyScopes: unused,
    retireParty: ({ actor, name }) => {
      if (!actor.scopes.includes('fleet:manage')) {
        return Promise.resolve(err({ kind: 'NOT_A_MANAGER' as const, message: 'Retiring an outside party needs fleet:manage' }));
      }
      retired.push(name);
      parties = parties.filter((party) => party.name !== name);
      return Promise.resolve(ok(undefined));
    },
    stateParty: unused,
    markTool: unused,
    registerClient: unused,
    listToDecide: unused,
    listMine: unused,
    decideRequest: unused,
    readOutsideParties: unused,
    setOutsideParties: unused,
  };
}

beforeEach(async () => {
  parties = [LINEAR];
  retired = [];
  server = Fastify({ logger: false });
  registerOutsidePartyPage(server, { contextFor, signIn: 'pages' });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

function open(url: string, cookie?: string) {
  return server.inject({ url, headers: { host: HOST, ...(cookie === undefined ? {} : { cookie }) } });
}

function retire(name: string, sent: { cookie?: string; origin?: string } = {}) {
  return server.inject({
    method: 'POST',
    url: `/outside-parties/${name}/retire`,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', cookie: sent.cookie ?? MANAGER, origin: sent.origin ?? ORIGIN },
    payload: '',
  });
}

describe('an outside party, on its own page', () => {
  it('shows its handshake, state, proxy ship, owner and scopes', async () => {
    const shown = await open('/outside-parties/linear', READER);

    expect(shown.statusCode).toBe(200);
    expect(shown.body).toContain('Crewed');
    expect(shown.body).toContain('shp_01m3tbfspe96yf1rnr4ank9lin');
    expect(shown.body).toContain(OWNER);
    expect(shown.body).toContain('messages:send');
    expect(shown.body).toContain('messages:receive');
    expect(shown.body).toContain('https://mcp.linear.app/mcp?a=&lt;1&gt;');
    expect(shown.body).toContain('href="/outside-parties"');
  });

  it('says a party that does not exist is not there', async () => {
    const shown = await open('/outside-parties/notion', READER);

    expect(shown.statusCode).toBe(404);
    expect(shown.body).toContain('There is no outside party notion');
  });

  it('asks a caller with no session to sign in, coming back to this page', async () => {
    const shown = await open('/outside-parties/linear');

    expect(shown.statusCode).toBe(401);
    expect(shown.body).toContain('href="/sign-in?return_to=%2Foutside-parties%2Flinear"');
  });

  it('offers Retire only to an actor holding fleet:manage', async () => {
    expect((await open('/outside-parties/linear', MANAGER)).body).toContain('href="/outside-parties/linear/retire"');
    expect((await open('/outside-parties/linear', READER)).body).not.toContain('/outside-parties/linear/retire');
  });
});

describe('retiring an outside party', () => {
  it('confirms first, listing what happens, with a button that names it', async () => {
    const shown = await open('/outside-parties/linear/retire', MANAGER);

    expect(shown.statusCode).toBe(200);
    expect(shown.body).toContain('Retire linear?');
    expect(shown.body).toContain('Its proxy ship');
    expect(shown.body).toContain('lose its tools');
    expect(shown.body).toContain('Adding it again is a new request');
    expect(shown.body).toContain('action="/outside-parties/linear/retire"');
    expect(shown.body).toContain('Retire linear</button>');
    expect(retired).toEqual([]);
  });

  it('retires it and goes back to the outside parties', async () => {
    const sent = await retire('linear');

    expect(sent.statusCode).toBe(303);
    expect(sent.headers.location).toBe('/outside-parties');
    expect(retired).toEqual(['linear']);
  });

  it('says why the API refused, retiring nothing', async () => {
    const sent = await retire('linear', { cookie: READER });

    expect(sent.statusCode).toBe(403);
    expect(sent.body).toContain('Retiring an outside party needs fleet:manage');
    expect(retired).toEqual([]);
  });

  it('refuses a form sent from another origin', async () => {
    const sent = await retire('linear', { origin: 'https://evil.example.com' });

    expect(sent.statusCode).toBe(403);
    expect(retired).toEqual([]);
  });
});
