import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MarkTool } from '../../core/mcp-out/mark-tool.js';
import type { ApproveParty } from '../../core/parties/approve-party.js';
import type { ListedParty } from '../../core/parties/shown-party.js';
import type { CrewParty } from '../../core/parties/crew-party.js';
import { err, ok } from '../../core/shared/result.js';
import type { Context } from '../trpc/router.js';
import { registerPartiesPage } from './parties-page.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OWNER = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
const ARGO = 'aeolus_session=argo';
const VIEWER = 'aeolus_session=viewer';
const HOST = 'gateway.example.com';
const ORIGIN = `http://${HOST}`;

const CRM: ListedParty = {
  name: 'crm',
  kind: 'mcpServer',
  url: 'https://crm.example.com/mcp?a=1&b=<2>',
  credentialKind: 'bearer',
  concurrencyLimit: 4,
  state: 'awaitingCrew',
  proxyShipId: 'shp_01m3tbfspe96yf1rnr4ank9crm',
  ownerShipId: OWNER,
  scopes: ['messages:send', 'messages:receive'],
};

let server: FastifyInstance;
let approvals: Parameters<ApproveParty>[0][];
let crews: Parameters<CrewParty>[0][];
let marks: Parameters<MarkTool>[0][];
let stated: string[];

function contextFor(cookie: string | undefined): Context {
  const unused = () => Promise.reject(new Error('not used by the page'));
  return {
    cookie,
    crewToken: undefined,
    authenticateActor: ({ cookie: sent }) => {
      if (sent === ARGO) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'operator' as const, scopes: ['fleet:read', 'fleet:manage'] }));
      }
      if (sent === VIEWER) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'viewer' as const, scopes: ['fleet:read'] }));
      }
      return Promise.resolve(err({ kind: 'NOT_AN_ACTOR' as const, message: 'Sign in to the console of your fleet' }));
    },
    isServed: () => Promise.resolve(true),
    listToDecide: unused,
    listMine: unused,
    decideRequest: unused,
    heldConnection: unused,
    installationTokenSent: undefined,
    installation: { mode: 'open', token: undefined },
    setFleetEnabled: unused,
    readFleet: unused,
    deleteFleet: unused,
    endSignIns: unused,
    readConnection: unused,
    connect: unused,
    approveParty: (input) => {
      approvals.push(input);
      return Promise.resolve(input.name === 'taken' ? err({ kind: 'PARTY_EXISTS' as const, message: 'A party named taken exists' }) : ok({ ...CRM, name: input.name }));
    },
    crewParty: (input) => {
      crews.push(input);
      return Promise.resolve(ok({ ...CRM, state: 'crewed' as const }));
    },
    listParties: () => Promise.resolve([CRM]),
    retireParty: unused,
    readParty: unused,
    registerClient: unused,
    stateParty: ({ name }) => {
      stated.push(name);
      return Promise.resolve(ok({ capabilities: ['list_deals'] }));
    },
    readOutsideParties: unused,
    setOutsideParties: unused,
    markTool: (input) => {
      marks.push(input);
      return Promise.resolve(ok({ capabilities: ['list_deals'] }));
    },
  };
}

beforeEach(async () => {
  approvals = [];
  crews = [];
  marks = [];
  stated = [];
  server = Fastify({ logger: false });
  registerPartiesPage(server, { contextFor, signIn: 'pages' });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

function post(path: string, form: Record<string, string> & { origin?: string }) {
  const { origin, ...fields } = form;
  return server.inject({
    method: 'POST',
    url: path,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', cookie: ARGO, origin: origin ?? ORIGIN },
    payload: new URLSearchParams(fields).toString(),
  });
}

describe("the gateway's page of parties, for argo signed in to the console", () => {
  it("shows argo's parties, escaped, without a credential", async () => {
    const page = await server.inject({ url: '/parties', headers: { host: HOST, cookie: ARGO } });

    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.body).toContain('crm');
    expect(page.body).toContain('https://crm.example.com/mcp?a=1&amp;b=&lt;2&gt;');
    expect(page.body).toContain('awaitingCrew');
    expect(page.body).not.toContain('<2>');
  });

  it('asks a caller with no session to sign in, coming back to this page', async () => {
    const page = await server.inject({ url: '/parties', headers: { host: HOST } });

    expect(page.statusCode).toBe(401);
    expect(page.body).toContain('href="/sign-in?return_to=%2Fparties"');
  });

  it('shows a viewer the parties without the forms that change them', async () => {
    const page = await server.inject({ url: '/parties', headers: { host: HOST, cookie: VIEWER } });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('crm');
    expect(page.body).not.toContain('<form');
  });

  it('approves a party with a bearer credential', async () => {
    const answer = await post('/parties/approve', { requestId: 'r-1', name: 'erp', url: 'https://erp.example.com/mcp', credentialKind: 'bearer', token: 'erp-token', ownerShipId: OWNER, concurrencyLimit: '2' });

    expect({ status: answer.statusCode, location: answer.headers.location }).toEqual({ status: 303, location: '/parties' });
    expect(approvals).toEqual([{ operatorFleetId: FLEET, requestId: 'r-1', name: 'erp', url: 'https://erp.example.com/mcp', credential: { kind: 'bearer', token: 'erp-token' }, ownerShipId: OWNER, concurrencyLimit: 2, scopes: [] }]);
  });

  it('approves a party with OAuth client credentials', async () => {
    await post('/parties/approve', {
      requestId: 'r-2',
      name: 'erp',
      url: 'https://erp.example.com/mcp',
      credentialKind: 'clientCredentials',
      clientId: 'gw',
      clientSecret: 's',
      issuer: 'https://auth.example.com',
      scope: '',
      ownerShipId: OWNER,
      concurrencyLimit: '4',
    });

    expect(approvals[0]?.credential).toEqual({ kind: 'clientCredentials', clientId: 'gw', clientSecret: 's', issuer: 'https://auth.example.com' });
  });

  it("shows the API's refusal on the page, with its status", async () => {
    const answer = await post('/parties/approve', { requestId: 'r-3', name: 'taken', url: 'https://erp.example.com/mcp', credentialKind: 'bearer', token: 't', ownerShipId: OWNER, concurrencyLimit: '4' });

    expect(answer.statusCode).toBe(409);
    expect(answer.body).toContain('A party named taken exists');
  });

  it('refuses a form sent from another origin, changing nothing', async () => {
    const answer = await post('/parties/approve', { requestId: 'r-4', name: 'erp', url: 'https://erp.example.com/mcp', credentialKind: 'bearer', token: 't', ownerShipId: OWNER, concurrencyLimit: '4', origin: 'https://evil.example.com' });

    expect(answer.statusCode).toBe(403);
    expect(approvals).toEqual([]);
  });

  it('hands over a new secret for a proxy ship awaiting crew', async () => {
    await post('/parties/crew', { name: 'crm', secret: 'aeolus_sk_v1_new' });

    expect(crews).toEqual([{ operatorFleetId: FLEET, name: 'crm', secret: 'aeolus_sk_v1_new' }]);
  });

  it('states a party anew', async () => {
    await post('/parties/state', { name: 'crm' });

    expect(stated).toEqual(['crm']);
  });

  it('marks a tool repeatable, and takes the mark off', async () => {
    await post('/parties/mark', { name: 'crm', tool: 'create_deal', isRepeatable: 'on' });
    await post('/parties/mark', { name: 'crm', tool: 'create_deal' });

    expect(marks.map(({ isRepeatable }) => isRepeatable)).toEqual([true, false]);
  });
});
