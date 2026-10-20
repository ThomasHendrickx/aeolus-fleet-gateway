import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SetOutsideParties } from '../../core/outside-parties/set-outside-parties.js';
import type { ListedParty } from '../../core/parties/shown-party.js';
import { err, ok } from '../../core/shared/result.js';
import type { Context } from '../trpc/router.js';
import { registerOutsidePartiesPage } from './outside-parties-page.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const NETWORKER = 'aeolus_session=argo';
const VIEWER = 'aeolus_session=viewer';
const HOST = 'gateway.example.com';
const ORIGIN = `http://${HOST}`;
const OPEN_NETWORK_WARNING = 'This fleet applies no network rules, so every outside party would reach every ship. Confirm to turn outside parties on anyway.';

let server: FastifyInstance;
let isOn: boolean;
let isNetworkOpen: boolean;
const OWNER = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
const LINEAR: ListedParty = {
  name: 'linear',
  kind: 'mcpServer',
  url: 'https://mcp.linear.app/mcp',
  credentialKind: 'bearer',
  concurrencyLimit: 4,
  state: 'crewed',
  proxyShipId: 'shp_01m3tbfspe96yf1rnr4ank9lin',
  ownerShipId: OWNER,
  scopes: ['messages:send', 'messages:receive'],
};
const ORDERBOT: ListedParty = { name: 'orderbot<x>', kind: 'mcpClient', clientId: 'https://orderbot.example.com/client.json', state: 'awaitingCrew', proxyShipId: null, ownerShipId: OWNER, scopes: null };

let parties: ListedParty[];
let signInWay: 'pages' | 'none';
let switches: Omit<Parameters<SetOutsideParties>[0], 'actor' | 'as'>[];

function contextFor(cookie: string | undefined): Context {
  const unused = () => Promise.reject(new Error('not used by the page'));
  return {
    cookie,
    crewToken: undefined,
    authenticateActor: ({ cookie: sent }) => {
      if (sent === NETWORKER) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'operator' as const, scopes: ['fleet:read', 'fleet:manage', 'fleet:network'] }));
      }
      if (sent === VIEWER) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'viewer' as const, scopes: ['fleet:read'] }));
      }
      return Promise.resolve(err({ kind: 'NOT_AN_ACTOR' as const, message: 'Sign in to the console of your fleet' }));
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
    retireParty: unused,
    readParty: unused,
    stateParty: unused,
    markTool: unused,
    registerClient: unused,
    listToDecide: unused,
    listMine: unused,
    decideRequest: unused,
    readOutsideParties: () => Promise.resolve({ isOn }),
    setOutsideParties: ({ actor, isOn: isWanted, isOpenNetworkConfirmed }) => {
      if (!actor.scopes.includes('fleet:network')) {
        return Promise.resolve(err({ kind: 'NOT_A_NETWORKER' as const, message: 'Switching outside parties needs fleet:network' }));
      }
      switches.push({ isOn: isWanted, isOpenNetworkConfirmed });
      if (isWanted && !isOpenNetworkConfirmed && isNetworkOpen) {
        return Promise.resolve(err({ kind: 'OPEN_NETWORK' as const, message: OPEN_NETWORK_WARNING }));
      }
      isOn = isWanted;
      return Promise.resolve(ok({ isOn }));
    },
  };
}

beforeEach(async () => {
  isOn = false;
  isNetworkOpen = false;
  parties = [LINEAR, ORDERBOT];
  signInWay = 'pages';
  switches = [];
  server = Fastify({ logger: false });
  registerOutsidePartiesPage(server, { contextFor, signIn: signInWay });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

function page(cookie?: string) {
  return server.inject({ url: '/outside-parties', headers: { host: HOST, ...(cookie === undefined ? {} : { cookie }) } });
}

function turn(form: Record<string, string>, sent: { cookie?: string; origin?: string } = {}) {
  return server.inject({
    method: 'POST',
    url: '/outside-parties/switch',
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', cookie: sent.cookie ?? NETWORKER, origin: sent.origin ?? ORIGIN },
    payload: new URLSearchParams(form).toString(),
  });
}

describe("the outside parties page: the fleet's switch", () => {
  it("is drawn in the console's look, its tokens in light and dark", async () => {
    const shown = await page(NETWORKER);

    expect(shown.statusCode).toBe(200);
    expect(shown.headers['content-type']).toMatch(/^text\/html/);
    expect(shown.body).toContain('--tone-attention-fg:oklch(0.5 0.19 27)');
    expect(shown.body).toContain('--tone-attention-fg:oklch(0.84 0.09 25)');
    expect(shown.body).toContain('prefers-color-scheme: dark');
  });

  it('shows an actor holding fleet:network that outside parties are off, with the control to turn them on', async () => {
    const shown = await page(NETWORKER);

    expect(shown.body).toContain('Outside parties are off');
    expect(shown.body).toContain('action="/outside-parties/switch"');
    expect(shown.body).toContain('Turn on');
  });

  it('shows a viewer whether they are on, with no control', async () => {
    isOn = true;

    const shown = await page(VIEWER);

    expect(shown.statusCode).toBe(200);
    expect(shown.body).toContain('Outside parties are on');
    expect(shown.body).not.toContain('<form');
  });

  it('turns them on in a fleet with network rules, and goes back to the page', async () => {
    const answer = await turn({ isOn: 'true' });

    expect(answer.statusCode).toBe(303);
    expect(answer.headers.location).toBe('/outside-parties');
    expect(switches).toEqual([{ isOn: true, isOpenNetworkConfirmed: false }]);
    expect(isOn).toBe(true);
  });

  it('warns on an open network and stays off, offering to confirm', async () => {
    isNetworkOpen = true;

    const answer = await turn({ isOn: 'true' });

    expect(answer.statusCode).toBe(412);
    expect(answer.body).toContain(OPEN_NETWORK_WARNING);
    expect(answer.body).toContain('Outside parties are off');
    expect(answer.body).toContain('name="isOpenNetworkConfirmed" value="true"');
    expect(isOn).toBe(false);
  });

  it('turns them on in an open network once the warning is confirmed', async () => {
    isNetworkOpen = true;

    const answer = await turn({ isOn: 'true', isOpenNetworkConfirmed: 'true' });

    expect(answer.statusCode).toBe(303);
    expect(switches).toEqual([{ isOn: true, isOpenNetworkConfirmed: true }]);
    expect(isOn).toBe(true);
  });

  it('turns them off', async () => {
    isOn = true;

    const answer = await turn({ isOn: 'false' });

    expect(answer.statusCode).toBe(303);
    expect(switches).toEqual([{ isOn: false, isOpenNetworkConfirmed: false }]);
    expect(isOn).toBe(false);
  });

  it("refuses a viewer's form with the fleet's reason", async () => {
    const answer = await turn({ isOn: 'true' }, { cookie: VIEWER });

    expect(answer.statusCode).toBe(403);
    expect(answer.body).toContain('Switching outside parties needs fleet:network');
    expect(isOn).toBe(false);
  });

  it('refuses a form sent from another origin, changing nothing', async () => {
    const answer = await turn({ isOn: 'true' }, { origin: 'https://elsewhere.example.com' });

    expect(answer.statusCode).toBe(403);
    expect(switches).toEqual([]);
  });

  it('asks a caller with no session to sign in, coming back to this page', async () => {
    const shown = await page();

    expect(shown.statusCode).toBe(401);
    expect(shown.body).toContain('href="/sign-in?return_to=%2Foutside-parties"');
  });

  it('says a gateway that signs no one in does, sending nobody to the console', async () => {
    await server.close();
    signInWay = 'none';
    server = Fastify({ logger: false });
    registerOutsidePartiesPage(server, { contextFor, signIn: signInWay });
    await server.ready();

    const shown = await page();

    expect(shown.statusCode).toBe(401);
    expect(shown.body).toContain('This gateway signs no one in');
    expect(shown.body).not.toContain('fleet.example.com');
  });
});

describe('the outside parties page: every outside party of the fleet', () => {
  it('leads with how many outside parties the fleet has, per kind and per protocol', async () => {
    const shown = await page(VIEWER);

    expect(shown.body).toContain('aria-label="2 outside parties"');
    expect(shown.body).toContain('1 server');
    expect(shown.body).toContain('1 client');
    expect(shown.body).toContain('MCP 2');
  });

  it('shows each party as a card: its mark, name, protocol, kind, proxy ship status and owner, escaped', async () => {
    const shown = await page(VIEWER);

    expect(shown.body).toContain('class="party-card"');
    expect(shown.body).toContain('linear');
    expect(shown.body).toContain('orderbot&lt;x&gt;');
    expect(shown.body).toContain('class="tag protocol">MCP<');
    expect(shown.body).toContain('MCP server');
    expect(shown.body).toContain('MCP client');
    expect(shown.body).toContain('Crewed');
    expect(shown.body).toContain('Awaiting crew');
    expect(shown.body).toContain(OWNER);
  });

  it('shows the servers only, or the clients only', async () => {
    const servers = await server.inject({ url: '/outside-parties?kind=server', headers: { host: HOST, cookie: VIEWER } });
    const clients = await server.inject({ url: '/outside-parties?kind=client', headers: { host: HOST, cookie: VIEWER } });

    expect({ servers: servers.body.includes('linear') && !servers.body.includes('orderbot'), clients: clients.body.includes('orderbot') && !clients.body.includes('mcp.linear.app') }).toEqual({ servers: true, clients: true });
  });

  it('says when the fleet has no outside party yet', async () => {
    parties = [];

    const shown = await page(VIEWER);

    expect(shown.body).toContain('aria-label="0 outside parties"');
    expect(shown.body).toContain('No outside party yet');
  });
});
