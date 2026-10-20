import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DecideRequest } from '../../core/requests/decide-request.js';
import type { PendingRequest } from '../../core/requests/ports.js';
import { err, ok } from '../../core/shared/result.js';
import type { Context } from '../trpc/router.js';
import { registerOverviewPage } from './overview-page.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const APPROVER = 'aeolus_session=argo';
const VIEWER = 'aeolus_session=viewer';
const HOST = 'gateway.example.com';
const ORIGIN = `http://${HOST}`;
const OWNER = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
const NOW = new Date('2026-10-20T12:00:00.000Z');
const DAY = 86_400_000;

function aRequest(request: Partial<PendingRequest> & Pick<PendingRequest, 'requestId' | 'subject'>): PendingRequest {
  return {
    fleetId: FLEET,
    requesters: [{ accountId: 'acc_01m3tb1zgr5h2ffee12xnch8sv', personShipId: null }],
    askedAt: new Date(NOW.getTime() - DAY),
    expiresAt: new Date(NOW.getTime() + 6 * DAY),
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    ...request,
  };
}

const ORDERBOT = aRequest({ requestId: 'req_orderbot', subject: { kind: 'client', clientId: 'https://orderbot.example.com/client', clientName: 'Orderbot <Brightway>' } });
const LINEAR = aRequest({ requestId: 'req_linear', subject: { kind: 'server', url: 'https://mcp.linear.app/mcp' }, expiresAt: new Date(NOW.getTime() + DAY / 2) });

let server: FastifyInstance;
let toDecide: PendingRequest[];
let decisions: Omit<Parameters<DecideRequest>[0], 'actor'>[];
let refusal: { kind: 'ALREADY_DECIDED'; message: string } | undefined;

function contextFor(cookie: string | undefined): Context {
  const unused = () => Promise.reject(new Error('not used by the page'));
  return {
    cookie,
    crewToken: undefined,
    authenticateActor: ({ cookie: sent }) => {
      if (sent === APPROVER) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'operator' as const, scopes: ['fleet:read', 'fleet:manage', 'gateway:approve'] }));
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
    readConnection: unused,
    connect: unused,
    approveParty: unused,
    crewParty: unused,
    listParties: unused,
    stateParty: unused,
    markTool: unused,
    registerClient: unused,
    readOutsideParties: unused,
    setOutsideParties: unused,
    listToDecide: (actor) =>
      Promise.resolve(actor.scopes.includes('gateway:approve') ? ok(toDecide) : err({ kind: 'NOT_AN_APPROVER' as const, message: 'Deciding requests needs gateway:approve' })),
    decideRequest: ({ actor: _actor, ...decided }) => {
      decisions.push(decided);
      if (refusal !== undefined) {
        return Promise.resolve(err(refusal));
      }
      toDecide = toDecide.filter((request) => request.requestId !== decided.requestId);
      return Promise.resolve(ok({ state: decided.decision.kind === 'approve' ? ('approved' as const) : ('denied' as const), party: null }));
    },
  };
}

beforeEach(async () => {
  toDecide = [ORDERBOT, LINEAR];
  decisions = [];
  refusal = undefined;
  server = Fastify({ logger: false });
  registerOverviewPage(server, { contextFor, fleetUrl: 'https://fleet.example.com', clock: { now: () => NOW } });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

function get(url: string, cookie?: string) {
  return server.inject({ url, headers: { host: HOST, ...(cookie === undefined ? {} : { cookie }) } });
}

function decide(requestId: string, form: Record<string, string>, origin = ORIGIN) {
  return server.inject({
    method: 'POST',
    url: `/overview/requests/${requestId}/decide`,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', cookie: APPROVER, origin },
    payload: new URLSearchParams(form).toString(),
  });
}

describe('the Overview page: To decide', () => {
  it('shows an approver how many requests wait to decide, oldest first, each with its days left', async () => {
    const page = await get('/overview', APPROVER);

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('2 to decide');
    expect(page.body.indexOf('Orderbot &lt;Brightway&gt;')).toBeLessThan(page.body.indexOf('mcp.linear.app'));
    expect(page.body).toContain('6 d left');
    expect(page.body).toContain('href="/overview/requests/req_orderbot"');
  });

  it('shows a request on its last day in the attention tone', async () => {
    const page = await get('/overview', APPROVER);

    expect(page.body).toContain('class="badge tone-attention"');
    expect(page.body).toContain('Last day');
  });

  it('shows an actor who may not approve no requests to decide', async () => {
    const page = await get('/overview', VIEWER);

    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('to decide');
    expect(page.body).not.toContain('Orderbot');
  });

  it('opens one request with its decision: the owner, and scope rows the approver holds, messages locked on', async () => {
    const page = await get('/overview/requests/req_orderbot', APPROVER);

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Approve Orderbot &lt;Brightway&gt;');
    expect(page.body).toContain('name="ownerShipId"');
    expect(page.body).toContain('messages:send');
    expect(page.body).toContain('messages:receive');
    expect(page.body).toContain('name="scope:fleet:read"');
    expect(page.body).toContain('name="scope:gateway:approve"');
    expect(page.body).not.toContain('name="scope:messages:send"');
    expect(page.body).not.toContain('name="credentialKind"');
    expect(page.body).toContain('href="/overview/requests/req_linear"');
  });

  it("asks for a server's credential and calls at once when approving a server", async () => {
    const page = await get('/overview/requests/req_linear', APPROVER);

    expect(page.body).toContain('name="credentialKind"');
    expect(page.body).toContain('name="concurrencyLimit"');
  });

  it('says a request no longer waits when it is not to decide', async () => {
    const page = await get('/overview/requests/req_gone', APPROVER);

    expect(page.statusCode).toBe(404);
    expect(page.body).toContain('href="/overview"');
  });

  it('approves a client request with its owner and the scopes ticked, then goes back to the overview', async () => {
    const answer = await decide('req_orderbot', { decision: 'approve', name: 'orderbot', ownerShipId: OWNER, 'scope:fleet:read': 'on' });

    expect(answer.statusCode).toBe(303);
    expect(answer.headers.location).toBe('/overview');
    expect(decisions).toEqual([
      { requestId: 'req_orderbot', decision: { kind: 'approve', party: { name: 'orderbot', ownerShipId: OWNER, scopes: ['messages:send', 'messages:receive', 'fleet:read'] } } },
    ]);
  });

  it('approves a server request with its bearer credential', async () => {
    const answer = await decide('req_linear', { decision: 'approve', name: 'linear', ownerShipId: OWNER, credentialKind: 'bearer', token: 'secret', concurrencyLimit: '4' });

    expect(answer.statusCode).toBe(303);
    expect(decisions).toEqual([
      {
        requestId: 'req_linear',
        decision: {
          kind: 'approve',
          party: { name: 'linear', ownerShipId: OWNER, scopes: ['messages:send', 'messages:receive'] },
          server: { credential: { kind: 'bearer', token: 'secret' }, concurrencyLimit: 4 },
        },
      },
    ]);
  });

  it('denies a request', async () => {
    const answer = await decide('req_orderbot', { decision: 'deny' });

    expect(answer.statusCode).toBe(303);
    expect(decisions).toEqual([{ requestId: 'req_orderbot', decision: { kind: 'deny' } }]);
  });

  it("shows the API's refusal on the request, with its status", async () => {
    refusal = { kind: 'ALREADY_DECIDED', message: 'Another approver decided this request first' };

    const answer = await decide('req_orderbot', { decision: 'deny' });

    expect(answer.statusCode).toBe(409);
    expect(answer.body).toContain('Another approver decided this request first');
  });

  it('refuses a form sent from another origin, deciding nothing', async () => {
    const answer = await decide('req_orderbot', { decision: 'deny' }, 'https://elsewhere.example.com');

    expect(answer.statusCode).toBe(403);
    expect(decisions).toEqual([]);
  });

  it('asks a caller with no session to sign in to the console', async () => {
    const page = await get('/overview');

    expect(page.statusCode).toBe(401);
    expect(page.body).toContain('href="https://fleet.example.com"');
  });
});
