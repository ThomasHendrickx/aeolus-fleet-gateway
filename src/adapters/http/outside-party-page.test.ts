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
const CHANGER = 'aeolus_gateway_session=changer';
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
let isServerDown: boolean;
let changes: Record<string, unknown>[];

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
      if (sent === CHANGER) {
        return Promise.resolve(account(['fleet:read', 'fleet:owner', 'scopes:grant', 'deliveries:read']));
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
    changePartyOwner: ({ actor, name, ownerShipId }) => {
      if (!actor.scopes.includes('fleet:owner')) {
        return Promise.resolve(err({ kind: 'SCOPE_NOT_HELD' as const, message: 'Changing an outside party this way needs fleet:owner' }));
      }
      changes.push({ name, ownerShipId });
      return Promise.resolve(ok(undefined));
    },
    changePartyScopes: ({ actor, name, grant, revoke }) => {
      if (!actor.scopes.includes('scopes:grant')) {
        return Promise.resolve(err({ kind: 'SCOPE_NOT_HELD' as const, message: 'Changing an outside party this way needs scopes:grant' }));
      }
      changes.push({ name, grant: [...grant], revoke: [...revoke] });
      return Promise.resolve(ok({ scopes: [] }));
    },
    retireParty: ({ actor, name }) => {
      if (!actor.scopes.includes('fleet:manage')) {
        return Promise.resolve(err({ kind: 'NOT_A_MANAGER' as const, message: 'Retiring an outside party needs fleet:manage' }));
      }
      retired.push(name);
      parties = parties.filter((party) => party.name !== name);
      return Promise.resolve(ok(undefined));
    },
    checkServer: unused,
    readPartyTools: ({ name }) =>
      Promise.resolve(
        isServerDown
          ? err({ kind: 'SERVER_UNREACHABLE' as const, message: `The MCP server of ${name} could not be listed: connect ECONNREFUSED` })
          : ok({ tools: [{ name: 'list_issues', description: 'List issues <by team>' }, { name: 'get_issue' }] }),
      ),
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
  isServerDown = false;
  changes = [];
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

function change(form: Record<string, string>, sent: { cookie?: string } = {}) {
  return server.inject({
    method: 'POST',
    url: '/outside-parties/linear/change',
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', cookie: sent.cookie ?? CHANGER, origin: ORIGIN },
    payload: new URLSearchParams(form).toString(),
  });
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

describe("an outside MCP server's tools, on its page", () => {
  it('lists each tool the server answers now, by name and short description, escaped, with how many', async () => {
    const shown = await open('/outside-parties/linear', READER);

    expect(shown.body).toContain('Tools');
    expect(shown.body).toContain('<span class="count">2</span>');
    expect(shown.body).toContain('list_issues');
    expect(shown.body).toContain('List issues &lt;by team&gt;');
    expect(shown.body).toContain('get_issue');
  });

  it('says why the server could not be listed, and shows the party all the same', async () => {
    isServerDown = true;

    const shown = await open('/outside-parties/linear', READER);

    expect(shown.statusCode).toBe(200);
    expect(shown.body).toContain('The MCP server of linear could not be listed: connect ECONNREFUSED');
    expect(shown.body).toContain('shp_01m3tbfspe96yf1rnr4ank9lin');
  });

  it('shows no tools for an MCP client', async () => {
    parties = [{ name: 'orderbot', kind: 'mcpClient', clientId: 'https://orderbot.example.com/client.json', state: 'crewed', proxyShipId: null, ownerShipId: OWNER, scopes: null }];

    const shown = await open('/outside-parties/orderbot', READER);

    expect(shown.body).not.toContain('class="tool-rows"');
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

describe("changing an outside party's owner and scopes", () => {
  it('offers Change only to an actor holding fleet:owner or scopes:grant', async () => {
    expect((await open('/outside-parties/linear', CHANGER)).body).toContain('href="/outside-parties/linear/change"');
    expect((await open('/outside-parties/linear', MANAGER)).body).not.toContain('/outside-parties/linear/change');
  });

  it("shows the owner, and the scopes the actor holds as rows, ticked where the party holds them, every app ship's scopes locked on", async () => {
    parties = [{ ...LINEAR, scopes: ['messages:send', 'messages:receive', 'fleet:read'] }];

    const shown = await open('/outside-parties/linear/change', CHANGER);

    expect(shown.statusCode).toBe(200);
    expect(shown.body).toContain(`name="ownerShipId" value="${OWNER}"`);
    expect(shown.body).toContain('<input type="checkbox" checked disabled aria-label="Send">');
    expect(shown.body).toContain('<input type="checkbox" name="scope:fleet:read" checked aria-label="Read the fleet">');
    expect(shown.body).toContain('<input type="checkbox" name="scope:deliveries:read" aria-label="deliveries:read">');
    expect(shown.body).toContain('name="scopesShown" value="true"');
  });

  it('changes the owner, and grants and revokes only what the rows changed, then shows the party', async () => {
    parties = [{ ...LINEAR, scopes: ['messages:send', 'messages:receive', 'fleet:read'] }];
    const newOwner = 'shp_01m3tbfspe96yf1rnr4ank9new';

    const sent = await change({ ownerShipId: newOwner, scopesShown: 'true', 'scope:deliveries:read': 'on' });

    expect(sent.statusCode).toBe(303);
    expect(sent.headers.location).toBe('/outside-parties/linear');
    expect(changes).toEqual([
      { name: 'linear', ownerShipId: newOwner },
      { name: 'linear', grant: ['deliveries:read'], revoke: ['fleet:read'] },
    ]);
  });

  it('calls the fleet for nothing that did not change', async () => {
    parties = [{ ...LINEAR, scopes: ['messages:send', 'messages:receive', 'fleet:read'] }];

    await change({ ownerShipId: OWNER, scopesShown: 'true', 'scope:fleet:read': 'on' });

    expect(changes).toEqual([]);
  });

  it('revokes nothing when the form showed no scope rows', async () => {
    parties = [{ ...LINEAR, scopes: ['messages:send', 'messages:receive', 'fleet:read'] }];

    await change({ ownerShipId: OWNER });

    expect(changes).toEqual([]);
  });

  it('says an owner that is not a ship id is not one, changing nothing', async () => {
    const sent = await change({ ownerShipId: 'charlotte' });

    expect(sent.statusCode).toBe(400);
    expect(sent.body).toContain('not a ship id');
    expect(changes).toEqual([]);
  });

  it('says why the API refused', async () => {
    const sent = await change({ ownerShipId: 'shp_01m3tbfspe96yf1rnr4ank9new' }, { cookie: READER });

    expect(sent.statusCode).toBe(403);
    expect(sent.body).toContain('needs fleet:owner');
  });
});
