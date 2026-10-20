import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ANSWER_CONTENT_TYPE, QUESTION_CONTENT_TYPE } from '@aeolus-fleet/common';

import type { InboxEntry } from '../../core/people/inbox-entry.js';
import type { DecideRequest } from '../../core/requests/decide-request.js';
import type { PendingRequest } from '../../core/requests/ports.js';
import { err, ok } from '../../core/shared/result.js';
import type { Context } from '../trpc/router.js';
import { overviewLivePages, registerOverviewPage } from './overview-page.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const APPROVER = 'aeolus_session=argo';
const VIEWER = 'aeolus_session=viewer';
const PERSON = 'aeolus_gateway_session=charlotte';
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
let dealt: Record<string, string>[];

const QUESTION_ID = '0f7f8d2a-5c1e-4b8e-9d3a-2a6b1c9e7f10';
const QUESTION = {
  id: QUESTION_ID,
  title: 'Publish the PRD draft to Linear?',
  context: 'The draft <is> ready.',
  options: [
    { key: 1, label: 'Publish', detail: '' },
    { key: 2, label: 'Hold', detail: '' },
  ],
  pick: { option: 1, why: 'It is reviewed.' },
};
const WAITING: InboxEntry[] = [
  { deliveryId: 'dlv_question', from: 'prd-writer', title: 'Publish the PRD draft to Linear?', sentAt: '2026-10-20T10:00:00.000Z' },
  { deliveryId: 'dlv_message', from: 'research-01', title: 'Weekly summary is ready', sentAt: '2026-10-20T11:00:00.000Z' },
];
const OPENED: Record<string, { contentType: string; payload: string }> = {
  dlv_question: { contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify(QUESTION) },
  dlv_message: { contentType: 'text/plain', payload: 'Read it <here>.' },
};

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
      if (sent === PERSON) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'account' as const, accountId: 'acc-charlotte', personShipId: OWNER, grantId: 'grant-1', scopes: ['fleet:read'] }));
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
    listParties: unused,
    stateParty: unused,
    markTool: unused,
    registerClient: unused,
    readOutsideParties: unused,
    setOutsideParties: unused,
    listToDecide: (actor) =>
      Promise.resolve(actor.scopes.includes('gateway:approve') ? ok(toDecide) : err({ kind: 'NOT_AN_APPROVER' as const, message: 'Deciding requests needs gateway:approve' })),
    person: {
      readInbox: () => Promise.resolve(ok({ waiting: WAITING.length, deliveries: WAITING })),
      openDelivery: ({ deliveryId }) => {
        const entry = WAITING.find((waiting) => waiting.deliveryId === deliveryId);
        const opened = OPENED[deliveryId];
        return Promise.resolve(
          entry === undefined || opened === undefined ? err({ kind: 'NO_SUCH_DELIVERY' as const, message: `No delivery ${deliveryId} waits for you: read your inbox again` }) : ok({ ...entry, ...opened }),
        );
      },
      answerDelivery: ({ deliveryId, contentType, payload }) => {
        dealt.push({ deliveryId, contentType, payload });
        return Promise.resolve(ok({ deliveryId, isHandled: true as const }));
      },
      doneDelivery: ({ deliveryId }) => {
        dealt.push({ deliveryId });
        return Promise.resolve(ok({ deliveryId, isHandled: true as const }));
      },
    },
    decideRequest: ({ requestId, decision }) => {
      const decided = { requestId, decision };
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
  dealt = [];
  server = Fastify({ logger: false });
  registerOverviewPage(server, { contextFor, signIn: { kind: 'pages' }, clock: { now: () => NOW } });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

function get(url: string, cookie?: string) {
  return server.inject({ url, headers: { host: HOST, ...(cookie === undefined ? {} : { cookie }) } });
}

function decide(requestId: string, form: Record<string, string> & { origin?: string }) {
  const { origin = ORIGIN, ...fields } = form;
  return server.inject({
    method: 'POST',
    url: `/overview/requests/${requestId}/decide`,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', cookie: APPROVER, origin },
    payload: new URLSearchParams(fields).toString(),
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
    const answer = await decide('req_orderbot', { decision: 'deny', origin: 'https://elsewhere.example.com' });

    expect(answer.statusCode).toBe(403);
    expect(decisions).toEqual([]);
  });

  it('asks a caller with no session to sign in, coming back to the page they asked for', async () => {
    const page = await get('/overview/requests/req_orderbot');

    expect(page.statusCode).toBe(401);
    expect(page.body).toContain('href="/sign-in?return_to=%2Foverview%2Frequests%2Freq_orderbot"');
  });

  it('offers a person signed in to the pages to sign out', async () => {
    const page = await get('/overview', PERSON);

    expect(page.body).toContain('<form method="post" action="/sign-out"');
  });

  it('offers no sign-out to a console session, which signs out in the console', async () => {
    const page = await get('/overview', APPROVER);

    expect(page.body).not.toContain('action="/sign-out"');
  });
});

describe('the Overview page, live', () => {
  const live = overviewLivePages({ clock: { now: () => NOW } });

  it('opens the live channel for its To decide, and counts each days left down in the page', async () => {
    const page = await get('/overview', APPROVER);

    expect(page.body).toContain('data-live="overview"');
    expect(page.body).toContain('data-live-query="page=overview"');
    expect(page.body).toContain(`data-expires-at="${ORDERBOT.expiresAt.toISOString()}"`);
  });

  it('opens the live channel for one request, its queue and the request', async () => {
    const page = await get('/overview/requests/req_orderbot', APPROVER);

    expect(page.body).toContain('data-live="queue"');
    expect(page.body).toContain('data-live="request"');
    expect(page.body).toContain('data-live-query="page=request&amp;requestId=req_orderbot"');
  });

  it('reads To decide again as its caller', async () => {
    toDecide = [LINEAR];

    const sections = await live.overview.render(contextFor(APPROVER), new URLSearchParams('page=overview'));

    expect(sections.overview).toContain('1 to decide');
    expect(sections.overview).not.toContain('Orderbot');
  });

  it('reads the queue again and leaves the decision being typed alone while the request still waits', async () => {
    toDecide = [ORDERBOT];

    const sections = await live.request.render(contextFor(APPROVER), new URLSearchParams('page=request&requestId=req_orderbot'));

    expect(Object.keys(sections)).toEqual(['queue']);
    expect(sections.queue).not.toContain('mcp.linear.app');
  });

  it('says the request no longer waits once it was decided elsewhere', async () => {
    toDecide = [LINEAR];

    const sections = await live.request.render(contextFor(APPROVER), new URLSearchParams('page=request&requestId=req_orderbot'));

    expect(sections.request).toContain('no longer waits');
  });
});

describe('the Overview page: what waits on a person', () => {
  function post(url: string, form: Record<string, string> & { origin?: string }) {
    const { origin = ORIGIN, ...fields } = form;
    return server.inject({ method: 'POST', url, headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', cookie: PERSON, origin }, payload: new URLSearchParams(fields).toString() });
  }

  it('leads a person with how many deliveries wait on them, each by its sender and title', async () => {
    const page = await get('/overview', PERSON);

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('aria-label="2 wait on you"');
    expect(page.body).toContain('prd-writer');
    expect(page.body).toContain('Weekly summary is ready');
    expect(page.body).toContain('action="/overview/deliveries/dlv_question/open"');
  });

  it("opens a question with one button per option, each naming what it sends, the asker's pick marked", async () => {
    const opened = await post('/overview/deliveries/dlv_question/open', {});

    expect(opened.statusCode).toBe(200);
    expect(opened.body).toContain('The draft &lt;is&gt; ready.');
    expect(opened.body).toContain('name="option" value="1"');
    expect(opened.body).toContain('name="option" value="2"');
    expect(opened.body).toMatch(/class="[^"]*pick[^"]*"[^>]*name="option" value="1"/);
    expect(opened.body).toContain('Publish is the pick of prd-writer');
  });

  it('answers a question with the option tapped, as the answer content type', async () => {
    const answered = await post('/overview/deliveries/dlv_question/answer', { questionId: QUESTION_ID, option: '2' });

    expect(answered.statusCode).toBe(303);
    expect(answered.headers.location).toBe('/overview');
    expect(dealt).toEqual([{ deliveryId: 'dlv_question', contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId: QUESTION_ID, option: 2 }) }]);
  });

  it('opens a message, escaped, and is done with it', async () => {
    const opened = await post('/overview/deliveries/dlv_message/open', {});
    const done = await post('/overview/deliveries/dlv_message/done', {});

    expect(opened.body).toContain('Read it &lt;here&gt;.');
    expect(done.statusCode).toBe(303);
    expect(dealt).toEqual([{ deliveryId: 'dlv_message' }]);
  });

  it('answers a message with a note of its own', async () => {
    const answered = await post('/overview/deliveries/dlv_message/answer', { note: 'Thanks' });

    expect(answered.statusCode).toBe(303);
    expect(dealt).toEqual([{ deliveryId: 'dlv_message', contentType: 'text/plain', payload: 'Thanks' }]);
  });

  it('says a delivery that no longer waits', async () => {
    const opened = await post('/overview/deliveries/dlv_gone/open', {});

    expect(opened.statusCode).toBe(404);
    expect(opened.body).toContain('href="/overview"');
  });

  it('refuses a form sent from another origin, opening nothing', async () => {
    const opened = await post('/overview/deliveries/dlv_question/open', { origin: 'https://elsewhere.example.com' });

    expect(opened.statusCode).toBe(403);
  });
});
