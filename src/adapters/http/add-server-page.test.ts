import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ApproveParty } from '../../core/parties/approve-party.js';
import type { CheckServer } from '../../core/parties/check-server.js';
import { err, ok } from '../../core/shared/result.js';
import type { Context } from '../trpc/router.js';
import { registerAddServerPage } from './add-server-page.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const MANAGER = 'aeolus_gateway_session=manager';
const READER = 'aeolus_gateway_session=reader';
const HOST = 'gateway.example.com';
const ORIGIN = `http://${HOST}`;
const OWNER = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
const URL_SENT = 'https://mcp.linear.app/mcp';

let server: FastifyInstance;
let checks: Parameters<CheckServer>[0][];
let approvals: Parameters<ApproveParty>[0][];

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
    checkServer: (input) => {
      checks.push(input);
      if (input.url === 'https://down.example.com/mcp') {
        return Promise.resolve(err({ kind: 'SERVER_UNREACHABLE' as const, message: 'The MCP server could not be listed: connect ECONNREFUSED' }));
      }
      return Promise.resolve(ok({ tools: [{ name: 'list_issues', description: 'List issues <by team>' }, { name: 'get_issue' }] }));
    },
    approveParty: (input) => {
      approvals.push(input);
      if (input.name === 'taken') {
        return Promise.resolve(err({ kind: 'PARTY_EXISTS' as const, message: 'A party named taken was approved already' }));
      }
      return Promise.resolve(ok({ name: input.name, kind: 'mcpServer' as const, url: input.url, credentialKind: input.credential.kind, concurrencyLimit: input.concurrencyLimit, state: 'crewed' as const, proxyShipId: null }));
    },
    crewParty: unused,
    listParties: unused,
    readParty: unused,
    changePartyOwner: unused,
    changePartyScopes: unused,
    retireParty: unused,
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
  checks = [];
  approvals = [];
  server = Fastify({ logger: false });
  registerAddServerPage(server, { contextFor, signIn: 'pages' });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

function open(cookie?: string) {
  return server.inject({ url: '/outside-parties/add', headers: { host: HOST, ...(cookie === undefined ? {} : { cookie }) } });
}

function post(path: string, form: Record<string, string>, sent: { cookie?: string; origin?: string } = {}) {
  return server.inject({
    method: 'POST',
    url: path,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', cookie: sent.cookie ?? MANAGER, origin: sent.origin ?? ORIGIN },
    payload: new URLSearchParams(form).toString(),
  });
}

const ADDRESS = { url: URL_SENT, credentialKind: 'bearer', token: 'linear-token' };

describe('adding an outside MCP server: the address', () => {
  it("asks for the server's address and credential, step 1 of 3", async () => {
    const shown = await open(MANAGER);

    expect(shown.statusCode).toBe(200);
    expect(shown.body).toContain('Add MCP server');
    expect(shown.body).toContain('action="/outside-parties/add/check"');
    expect(shown.body).toContain('name="url"');
    expect(shown.body).toContain('name="token"');
    expect(shown.body).toContain('aria-current="step"');
  });

  it('asks a caller with no session to sign in, coming back to this page', async () => {
    const shown = await open();

    expect(shown.statusCode).toBe(401);
    expect(shown.body).toContain('href="/sign-in?return_to=%2Foutside-parties%2Fadd"');
  });
});

describe('adding an outside MCP server: the check', () => {
  it('shows how many tools the server answered with, and each by name, escaped, before it is added', async () => {
    const shown = await post('/outside-parties/add/check', ADDRESS);

    expect(shown.statusCode).toBe(200);
    expect(checks).toEqual([{ fleetId: FLEET, url: URL_SENT, credential: { kind: 'bearer', token: 'linear-token' } }]);
    expect(shown.body).toContain('aria-label="2 tools"');
    expect(shown.body).toContain('Server answers');
    expect(shown.body).toContain('list_issues');
    expect(shown.body).toContain('List issues &lt;by team&gt;');
    expect(approvals).toEqual([]);
  });

  it("goes on to the owner, the proxy ship's name offered from the address", async () => {
    const shown = await post('/outside-parties/add/check', ADDRESS);

    expect(shown.body).toContain('action="/outside-parties/add"');
    expect(shown.body).toContain('name="name" value="linear"');
    expect(shown.body).toContain('name="ownerShipId"');
    expect(shown.body).toContain(`name="url" value="${URL_SENT}"`);
  });

  it('says why the server could not be checked, keeping the address', async () => {
    const shown = await post('/outside-parties/add/check', { ...ADDRESS, url: 'https://down.example.com/mcp' });

    expect(shown.statusCode).toBe(502);
    expect(shown.body).toContain('The MCP server could not be listed: connect ECONNREFUSED');
    expect(shown.body).toContain('value="https://down.example.com/mcp"');
  });

  it('says why the API refused an actor without fleet:manage', async () => {
    const shown = await post('/outside-parties/add/check', ADDRESS, { cookie: READER });

    expect(shown.statusCode).toBe(403);
    expect(checks).toEqual([]);
  });
});

describe('adding an outside MCP server: the owner', () => {
  const OWNED = { ...ADDRESS, requestId: '0f7f8d2a-5c1e-4b8e-9d3a-2a6b1c9e7f10', name: 'linear', ownerShipId: OWNER, concurrencyLimit: '4' };

  it('approves it with the owner picked, and shows the party', async () => {
    const sent = await post('/outside-parties/add', OWNED);

    expect(sent.statusCode).toBe(303);
    expect(sent.headers.location).toBe('/outside-parties/linear');
    expect(approvals).toEqual([{ operatorFleetId: FLEET, requestId: OWNED.requestId, name: 'linear', url: URL_SENT, credential: { kind: 'bearer', token: 'linear-token' }, ownerShipId: OWNER, concurrencyLimit: 4, scopes: [] }]);
  });

  it('says an owner that is not a ship id is not one, approving nothing', async () => {
    const sent = await post('/outside-parties/add', { ...OWNED, ownerShipId: 'charlotte' });

    expect(sent.statusCode).toBe(400);
    expect(sent.body).toContain('not a ship id');
    expect(approvals).toEqual([]);
  });

  it('says why the API refused, keeping what was typed', async () => {
    const sent = await post('/outside-parties/add', { ...OWNED, name: 'taken' });

    expect(sent.statusCode).toBe(409);
    expect(sent.body).toContain('A party named taken was approved already');
    expect(sent.body).toContain('name="name" value="taken"');
  });

  it('refuses a form sent from another origin', async () => {
    const sent = await post('/outside-parties/add', OWNED, { origin: 'https://evil.example.com' });

    expect(sent.statusCode).toBe(403);
    expect(approvals).toEqual([]);
  });
});
