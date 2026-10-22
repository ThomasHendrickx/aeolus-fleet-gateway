import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CHARLOTTE_ACCOUNT_TOKEN, CHARLOTTE_SIGN_IN, CONSOLE_URL, fakeSharedSignIn } from '../../../test/support/account-sign-in-fakes.js';
import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { createAccountInView } from '../../core/account-sign-in/account-in-view.js';
import { createAccountOfSignIn } from '../../core/account-sign-in/account-of-sign-in.js';
import type { PersonCaller } from '../../core/people/person-crew.js';
import type { MarkTool } from '../../core/mcp-out/mark-tool.js';
import type { ApproveParty } from '../../core/parties/approve-party.js';
import type { SetOutsideParties } from '../../core/outside-parties/set-outside-parties.js';
import type { DecideRequest } from '../../core/requests/decide-request.js';
import type { PendingRequest } from '../../core/requests/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { createChangeHub, type ChangeHub } from '../http/live.js';
import { gatewayRouter, type Context } from './router.js';

/** The grant a person called by from an MCP client, or the account token their shared sign-in was exchanged for. */
function grantOf(caller: PersonCaller): string {
  return 'grantId' in caller ? caller.grantId : caller.signedIn.accountToken;
}

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OWNER = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
const ARGO_COOKIE = 'aeolus_session=argo';
const VIEWER_COOKIE = 'aeolus_session=viewer';
/** A person signed in to the gateway's pages, and one whose account token no longer works. */
const PERSON_COOKIE = 'aeolus_account_session=charlotte';
const SIGNED_OUT_COOKIE = 'aeolus_account_session=ended';
const PERSON_TOKEN = 'account-token-1';
const SHARED_ACCOUNT_TOKEN = 'account-token-shared';
const MANAGER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9mgr';
/** A ship's own crew tokens: one holding fleet:manage, one only reading. */
const MANAGER_CREW = 'aeolus_ct_v1_manager';
const READER_CREW = 'aeolus_ct_v1_reader';
/** A ship's own crew token holding gateway:approve. */
const APPROVER_CREW = 'aeolus_ct_v1_approver';
const REQUEST_ID = 'req_01m5c7hmbt9f1vrkwb37az0001';
const CURSOR_CLIENT = 'https://cursor.example.com/client.json';
const DELIVERY = 'dlv_01m3tbfspe96yf1rnr4ank9dlv';
const DECIDED = 'req_01m5c7hmbt9f1vrkwb37az0002';
const ORDERBOT_REQUEST: PendingRequest = {
  fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv',
  requestId: REQUEST_ID,
  subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' },
  requesters: [{ accountId: 'acc-charlotte', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9wnr' }],
  askedAt: new Date('2026-10-20T09:00:00.000Z'),
  expiresAt: new Date('2026-10-27T09:00:00.000Z'),
  state: 'pending',
  decidedBy: null,
  decidedAt: null,
};

/** A context with only what the parties procedures read; every approval it is asked for is recorded. */
function aContext(cookie: string | undefined, crewToken?: string): {
  context: Context;
  approvals: Parameters<ApproveParty>[0][];
  marks: Parameters<MarkTool>[0][];
  decisions: Parameters<DecideRequest>[0][];
  switched: Parameters<SetOutsideParties>[0][];
  answers: Record<string, string>[];
  changes: ChangeHub;
} {
  const approvals: Parameters<ApproveParty>[0][] = [];
  const switched: Parameters<SetOutsideParties>[0][] = [];
  const decisions: Parameters<DecideRequest>[0][] = [];
  const marks: Parameters<MarkTool>[0][] = [];
  const answers: Record<string, string>[] = [];
  const unused = () => Promise.reject(new Error('not used by the parties procedures'));
  const changes = createChangeHub();
  const context: Context = {
    cookie,
    crewToken,
    authenticateActor: (sent) => {
      if (sent.crewToken !== undefined) {
        const scopes = { [MANAGER_CREW]: ['fleet:read', 'fleet:manage'], [APPROVER_CREW]: ['fleet:read', 'gateway:approve'] }[sent.crewToken] ?? ['fleet:read'];
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'ship' as const, shipId: MANAGER, scopes }));
      }
      if (sent.signIn === CHARLOTTE_SIGN_IN && sent.fleetId === FLEET) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'account' as const, accountId: 'acc-charlotte', personShipId: OWNER, accountToken: SHARED_ACCOUNT_TOKEN, scopes: ['fleet:read'] }));
      }
      if (sent.cookie === PERSON_COOKIE || sent.cookie === SIGNED_OUT_COOKIE) {
        return Promise.resolve(ok({ fleetId: FLEET, kind: 'account' as const, accountId: 'acc-charlotte', personShipId: OWNER, accountToken: sent.cookie === PERSON_COOKIE ? PERSON_TOKEN : 'account-token-ended', scopes: ['fleet:read'] }));
      }
      return Promise.resolve(ok(sent.cookie === ARGO_COOKIE ? { fleetId: FLEET, kind: 'operator' as const, scopes: ['fleet:read', 'fleet:manage'] } : { fleetId: FLEET, kind: 'viewer' as const, scopes: ['fleet:read'] }));
    },
    person: {
      readInbox: (caller) =>
        Promise.resolve(
          [PERSON_TOKEN, SHARED_ACCOUNT_TOKEN].includes(grantOf(caller))
            ? ok({ waiting: 1, deliveries: [{ deliveryId: DELIVERY, from: 'prd-writer', title: 'Publish the PRD draft to Linear?', sentAt: '2026-10-20T09:00:00.000Z' }], opened: [] })
            : err({ kind: 'SIGNED_OUT' as const, message: 'Your sign-in ended: sign in again' }),
        ),
      openDelivery: ({ caller, deliveryId }) =>
        Promise.resolve(
          deliveryId === DELIVERY && [PERSON_TOKEN, SHARED_ACCOUNT_TOKEN].includes(grantOf(caller))
            ? ok({ deliveryId: DELIVERY, from: 'prd-writer', title: 'Publish the PRD draft to Linear?', sentAt: '2026-10-20T09:00:00.000Z', contentType: 'text/plain', payload: 'Publish it?' })
            : err({ kind: 'NO_SUCH_DELIVERY' as const, message: `No delivery ${deliveryId} waits for you: read your inbox again` }),
        ),
      answerDelivery: (input) => {
        answers.push({ grantId: grantOf(input.caller), deliveryId: input.deliveryId, contentType: input.contentType, payload: input.payload });
        return Promise.resolve(ok({ deliveryId: DELIVERY, isHandled: true as const }));
      },
      doneDelivery: (input) => {
        answers.push({ grantId: grantOf(input.caller), deliveryId: input.deliveryId });
        return Promise.resolve(ok({ deliveryId: DELIVERY, isHandled: true as const }));
      },
    },
    changes,
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
    approveParty: (input) => {
      approvals.push(input);
      return Promise.resolve(ok({ name: input.name, kind: 'mcpServer' as const, url: input.url, credentialKind: input.credential.kind, ownerShipId: input.ownerShipId, concurrencyLimit: input.concurrencyLimit, state: 'crewed' as const, proxyShipId: null }));
    },
    crewParty: unused,
    listParties: () => Promise.resolve([]),
    retireParty: unused,
    changePartyOwner: unused,
    changePartyScopes: unused,
    readParty: unused,
    readAuthorization: (request) =>
      Promise.resolve(
        request.client_id === CURSOR_CLIENT
          ? ok({ clientId: CURSOR_CLIENT, clientName: 'Cursor', clientFleetId: null, redirectUri: 'http://127.0.0.1:7777/callback', codeChallenge: 'challenge', resource: 'https://gateway.example.com/mcp', scope: null, state: 'state-1' })
          : err({ kind: 'invalidClient' as const, message: 'No client client-unknown is known' }),
      ),
    watchWaiting: ({ waiting, browserSecret }) =>
      Promise.resolve(
        waiting === 'waiting-1' && browserSecret === 'secret-1'
          ? ok({ fleetId: FLEET_ID, clientName: 'Cursor', isWaiting: true, expiresAt: new Date('2026-10-28T09:00:00.000Z') })
          : waiting === 'waiting-1'
            ? err({ kind: 'otherBrowser' as const })
            : ok({ fleetId: FLEET_ID, clientName: 'Cursor', isWaiting: false, expiresAt: new Date('2026-10-28T09:00:00.000Z') }),
      ),
    registerClient: (input) => Promise.resolve(input.redirectUris.length === 0 ? err({ kind: 'INVALID_REDIRECT_URIS' as const, message: 'A client registers 1 to 10 redirect URIs' }) : ok({ clientId: 'client-1', clientSecret: input.isConfidential ? 's' : null })),
    checkServer: ({ url }) =>
      Promise.resolve(url === 'https://down.example.com/mcp' ? err({ kind: 'SERVER_UNREACHABLE' as const, message: 'The MCP server could not be listed: connect ECONNREFUSED' }) : ok({ tools: [{ name: 'list_issues', description: 'List issues' }] })),
    readPartyTools: ({ name }) => Promise.resolve(name === 'linear' ? ok({ tools: [{ name: 'list_issues', description: 'List issues' }] }) : err({ kind: 'NO_SUCH_PARTY' as const, message: `There is no outside MCP server ${name}` })),
    stateParty: ({ name }) => Promise.resolve(name === 'crm' ? ok({ capabilities: ['list_deals'] }) : err({ kind: 'NO_SUCH_PARTY' as const, message: `No party named ${name}` })),
    markTool: (input) => {
      marks.push(input);
      return Promise.resolve(ok({ capabilities: ['list_deals'] }));
    },
    readOutsideParties: () => Promise.resolve({ isOn: false }),
    setOutsideParties: (input) => {
      switched.push(input);
      if (input.isOn && !input.isOpenNetworkConfirmed) {
        return Promise.resolve(err({ kind: 'OPEN_NETWORK' as const, message: 'This fleet applies no network rules' }));
      }
      return Promise.resolve(ok({ isOn: input.isOn }));
    },
    listMine: (actor) =>
      Promise.resolve(actor.kind === 'account' ? ok([{ ...ORDERBOT_REQUEST, state: 'denied' as const, decidedBy: { kind: 'account' as const, accountId: 'acc-pieter' }, decidedAt: new Date('2026-10-21T09:00:00.000Z') }]) : err({ kind: 'NOT_AN_ACCOUNT' as const, message: 'Only a person signed in to the gateway has requests of their own' })),
    listToDecide: (actor) =>
      Promise.resolve(actor.scopes.includes('gateway:approve') ? ok([ORDERBOT_REQUEST]) : err({ kind: 'NOT_AN_APPROVER' as const, message: 'Deciding requests needs gateway:approve' })),
    decideRequest: (input) => {
      decisions.push(input);
      if (input.requestId === DECIDED) {
        return Promise.resolve(err({ kind: 'ALREADY_DECIDED' as const, message: 'This request was denied already' }));
      }
      return Promise.resolve(ok({ state: 'denied' as const, party: null }));
    },
  };
  return { context, approvals, marks, decisions, switched, answers, changes };
}

const APPROVAL = { requestId: 'a-1', name: 'crm', url: 'https://crm.example.com/mcp', credential: { kind: 'bearer' as const, token: 'crm-token' }, ownerShipId: OWNER };

type ApprovalInput = Parameters<ReturnType<typeof gatewayRouter.createCaller>['parties']['approve']>[0];

/** An input as it arrives over HTTP: anything, for the router's own parsing to judge. */
const asSent = (input: unknown): ApprovalInput => z.custom<ApprovalInput>(() => true).parse(input);

describe("argo approves parties through the gateway's API", () => {
  it("approves for argo's fleet, with the default concurrency limit of 4", async () => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.approve(APPROVAL);

    expect(approvals).toEqual([{ operatorFleetId: FLEET, ...APPROVAL, concurrencyLimit: 4, scopes: [] }]);
  });

  it('refuses a viewer, who only reads', async () => {
    const { context, approvals } = aContext(VIEWER_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.approve(APPROVAL)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(approvals).toEqual([]);
  });

  it('approves for a ship holding fleet:manage, by its own crew token (decision 0057)', async () => {
    const { context, approvals } = aContext(undefined, MANAGER_CREW);

    await gatewayRouter.createCaller(context).parties.approve(APPROVAL);

    expect(approvals).toEqual([{ operatorFleetId: FLEET, ...APPROVAL, concurrencyLimit: 4, scopes: [] }]);
  });

  it('refuses a ship that only reads, and lets it read the parties', async () => {
    const { context, approvals } = aContext(undefined, READER_CREW);

    await expect(gatewayRouter.createCaller(context).parties.approve(APPROVAL)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(gatewayRouter.createCaller(context).parties.list()).resolves.toEqual([]);
    expect(approvals).toEqual([]);
  });

  it('lets a viewer read the parties', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.list()).resolves.toEqual([]);
  });

  it.each([
    ['a URL that is not http or https', { ...APPROVAL, url: 'ftp://crm.example.com/mcp' }],
    ['an empty bearer token', { ...APPROVAL, credential: { kind: 'bearer', token: '' } }],
    ['client credentials without an issuer', { ...APPROVAL, credential: { kind: 'clientCredentials', clientId: 'gw', clientSecret: 's' } }],
    ['a concurrency limit of 0', { ...APPROVAL, concurrencyLimit: 0 }],
    ['a concurrency limit of 11, over the 10 calls core hands a proxy ship at once', { ...APPROVAL, concurrencyLimit: 11 }],
    ['a name that is no ship handle', { ...APPROVAL, name: 'the CRM' }],
  ])('refuses %s', async (_what, approval) => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.approve(asSent(approval))).rejects.toBeInstanceOf(TRPCError);
    expect(approvals).toEqual([]);
  });

  it('takes a concurrency limit of 10', async () => {
    const { context, approvals } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.approve({ ...APPROVAL, concurrencyLimit: 10 });

    expect(approvals[0]?.concurrencyLimit).toBe(10);
  });
});

describe("an actor holding fleet:manage checks an outside MCP server through the gateway's API (F10)", () => {
  const CHECK = { url: 'https://mcp.linear.app/mcp', credential: { kind: 'bearer' as const, token: 'linear-token' } };

  it('answers the tools the server lists', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.check(CHECK)).resolves.toEqual({ tools: [{ name: 'list_issues', description: 'List issues' }] });
  });

  it('answers BAD_GATEWAY when the server cannot be listed', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.check({ ...CHECK, url: 'https://down.example.com/mcp' })).rejects.toMatchObject({ code: 'BAD_GATEWAY', message: 'The MCP server could not be listed: connect ECONNREFUSED' });
  });

  it('refuses an actor without fleet:manage', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.check(CHECK)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe("an actor reads an outside MCP server's tools through the gateway's API", () => {
  it('answers the tools the server lists now', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.tools({ name: 'linear' })).resolves.toEqual({ tools: [{ name: 'list_issues', description: 'List issues' }] });
  });

  it('answers NOT_FOUND for a server it does not know', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).parties.tools({ name: 'notion' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

type MarkInput = Parameters<ReturnType<typeof gatewayRouter.createCaller>['parties']['markTool']>[0];

describe("argo states a party's tools and marks them repeatable through the gateway's API", () => {
  it("states a party's proxy ship, answering its capabilities", async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.state({ name: 'crm' })).resolves.toEqual({ capabilities: ['list_deals'] });
  });

  it('answers NOT_FOUND for a party it does not know', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).parties.state({ name: 'erp' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("marks a tool for argo's fleet", async () => {
    const { context, marks } = aContext(ARGO_COOKIE);

    await gatewayRouter.createCaller(context).parties.markTool({ name: 'crm', tool: 'create_deal', isRepeatable: true });

    expect(marks).toEqual([{ fleetId: FLEET, name: 'crm', tool: 'create_deal', isRepeatable: true }]);
  });

  it('refuses a viewer a mark or a statement', async () => {
    const { context, marks } = aContext(VIEWER_COOKIE);
    const caller = gatewayRouter.createCaller(context);

    await expect(caller.parties.markTool({ name: 'crm', tool: 'create_deal', isRepeatable: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.parties.state({ name: 'crm' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(marks).toEqual([]);
  });

  it.each([
    ['an empty tool name', ''],
    ['a tool name over 128 characters', 'x'.repeat(129)],
  ])('refuses %s', async (_what, tool) => {
    const { context, marks } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).parties.markTool(z.custom<MarkInput>(() => true).parse({ name: 'crm', tool, isRepeatable: true }))).rejects.toBeInstanceOf(TRPCError);
    expect(marks).toEqual([]);
  });
});

describe('argo pre-registers MCP clients through the gateway\'s API', () => {
  it("registers a client for argo's fleet, answering its secret once", async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).oauth.registerClient({ name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], isConfidential: true })).resolves.toEqual({
      clientId: 'client-1',
      clientSecret: 's',
    });
  });

  it('refuses a viewer', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).oauth.registerClient({ name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], isConfidential: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers BAD_REQUEST to redirect URIs it refuses', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).oauth.registerClient({ name: 'Cursor', redirectUris: [], isConfidential: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

type DecideInput = Parameters<ReturnType<typeof gatewayRouter.createCaller>['requests']['decide']>[0];

describe("an approver decides pending requests through the gateway's API (decision 0056)", () => {
  it('lists the requests to decide, their times as ISO text', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).requests.toDecide()).resolves.toEqual([
      { ...ORDERBOT_REQUEST, askedAt: '2026-10-20T09:00:00.000Z', expiresAt: '2026-10-27T09:00:00.000Z', decidedAt: null },
    ]);
  });

  it('answers FORBIDDEN to an actor without gateway:approve', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, READER_CREW).context).requests.toDecide()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('decides as the actor, with the owner and scopes given', async () => {
    const { context, decisions } = aContext(undefined, APPROVER_CREW);
    const decision = { kind: 'approve' as const, party: { name: 'orderbot', ownerShipId: OWNER, scopes: ['fleet:read'] } };

    await gatewayRouter.createCaller(context).requests.decide({ requestId: REQUEST_ID, decision });

    expect(decisions).toEqual([{ actor: { fleetId: FLEET, kind: 'ship', shipId: MANAGER, scopes: ['fleet:read', 'gateway:approve'] }, requestId: REQUEST_ID, decision }]);
  });

  it('answers CONFLICT to a request decided already', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined, APPROVER_CREW).context).requests.decide({ requestId: DECIDED, decision: { kind: 'deny' } })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it.each([
    ['a decision it does not know', { requestId: REQUEST_ID, decision: { kind: 'hold' } }],
    ['an owner that is no ship id', { requestId: REQUEST_ID, decision: { kind: 'approve', party: { name: 'orderbot', ownerShipId: 'charlotte', scopes: [] } } }],
    ['a name that is no ship handle', { requestId: REQUEST_ID, decision: { kind: 'approve', party: { name: 'Order Bot', ownerShipId: OWNER, scopes: [] } } }],
  ])('refuses %s, deciding nothing', async (_what, input) => {
    const { context, decisions } = aContext(undefined, APPROVER_CREW);

    await expect(gatewayRouter.createCaller(context).requests.decide(z.custom<DecideInput>(() => true).parse(input))).rejects.toBeInstanceOf(TRPCError);
    expect(decisions).toEqual([]);
  });
});

describe("outside parties are switched per fleet through the gateway's API (interop I-3)", () => {
  it('reads whether they are on', async () => {
    await expect(gatewayRouter.createCaller(aContext(VIEWER_COOKIE).context).outsideParties.status()).resolves.toEqual({ isOn: false });
  });

  it("switches them as the actor, with the actor's own credential to read the network", async () => {
    const { context, switched } = aContext(undefined, MANAGER_CREW);

    await gatewayRouter.createCaller(context).outsideParties.set({ isOn: true, isOpenNetworkConfirmed: true });

    expect(switched).toEqual([{ actor: { fleetId: FLEET, kind: 'ship', shipId: MANAGER, scopes: ['fleet:read', 'fleet:manage'] }, as: { cookie: undefined, crewToken: MANAGER_CREW }, isOn: true, isOpenNetworkConfirmed: true }]);
  });

  it('answers PRECONDITION_FAILED with the warning for an open network, until it is confirmed', async () => {
    await expect(gatewayRouter.createCaller(aContext(ARGO_COOKIE).context).outsideParties.set({ isOn: true, isOpenNetworkConfirmed: false })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This fleet applies no network rules',
    });
  });
});

describe("a person reads and deals with their person ship's deliveries through the gateway's API, signed in to its pages", () => {
  it('reads what waits, by titles only', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.inbox()).resolves.toEqual({
      waiting: 1,
      deliveries: [{ deliveryId: DELIVERY, from: 'prd-writer', title: 'Publish the PRD draft to Linear?', sentAt: '2026-10-20T09:00:00.000Z' }],
      opened: [],
    });
  });

  it('opens one, whole', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.open({ deliveryId: DELIVERY })).resolves.toMatchObject({ contentType: 'text/plain', payload: 'Publish it?' });
  });

  it('answers one it opened, and is done with another, as its own account', async () => {
    const { context, answers } = aContext(PERSON_COOKIE);
    const caller = gatewayRouter.createCaller(context);

    await caller.people.answer({ deliveryId: DELIVERY, contentType: 'text/plain', payload: 'Yes' });
    await caller.people.done({ deliveryId: DELIVERY });

    expect(answers).toEqual([
      { grantId: PERSON_TOKEN, deliveryId: DELIVERY, contentType: 'text/plain', payload: 'Yes' },
      { grantId: PERSON_TOKEN, deliveryId: DELIVERY },
    ]);
  });

  it('says a delivery that no longer waits is not found', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.open({ deliveryId: 'dlv_gone' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('asks a person whose sign-in ended to sign in again', async () => {
    const { context } = aContext(SIGNED_OUT_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.inbox()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it("reads, opens and answers as the account their shared sign-in names in the page's fleet (header design H5)", async () => {
    const { context, answers } = aContext(undefined);
    const caller = gatewayRouter.createCaller({ ...context, signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET });

    await expect(caller.people.inbox()).resolves.toMatchObject({ waiting: 1 });
    await expect(caller.people.open({ deliveryId: DELIVERY })).resolves.toMatchObject({ payload: 'Publish it?' });
    await caller.people.done({ deliveryId: DELIVERY });
    expect(answers).toEqual([{ grantId: SHARED_ACCOUNT_TOKEN, deliveryId: DELIVERY }]);
  });

  it('refuses any other actor: only a person has a person ship', async () => {
    const { context } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).people.inbox()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe("the web app's authorize pages read the request they show through the API, as anyone", () => {
  it('reads the client an authorization request is for, to show its picks', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined).context).oauth.authorization({ client_id: CURSOR_CLIENT, state: 'state-1' })).resolves.toEqual({
      clientId: CURSOR_CLIENT,
      clientName: 'Cursor',
      redirectUri: 'http://127.0.0.1:7777/callback',
    });
  });

  it('refuses a request the gateway would not serve, saying why', async () => {
    await expect(gatewayRouter.createCaller(aContext(undefined).context).oauth.authorization({ client_id: 'client-unknown' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'No client client-unknown is known' });
  });

  it('reads a waiting client by the secret its browser holds, sent beside the call, with the time it is kept', async () => {
    const context = { ...aContext(undefined).context, waitingSecret: 'secret-1' };

    await expect(gatewayRouter.createCaller(context).oauth.waiting({ waiting: 'waiting-1' })).resolves.toEqual({ kind: 'waiting', clientName: 'Cursor', expiresAt: '2026-10-28T09:00:00.000Z' });
  });

  it('tells the page to go on, to the door that says why, when the client no longer waits or the browser is another', async () => {
    const decided = gatewayRouter.createCaller({ ...aContext(undefined).context, waitingSecret: 'secret-1' });
    const other = gatewayRouter.createCaller({ ...aContext(undefined).context, waitingSecret: 'other' });
    const none = gatewayRouter.createCaller(aContext(undefined).context);

    await expect(Promise.all([decided.oauth.waiting({ waiting: 'waiting-2' }), other.oauth.waiting({ waiting: 'waiting-1' }), none.oauth.waiting({ waiting: 'waiting-1' })])).resolves.toEqual([{ kind: 'goOn' }, { kind: 'goOn' }, { kind: 'goOn' }]);
  });

  it("refuses the browser's secret in the call's input, which would travel in the address", async () => {
    const caller = gatewayRouter.createCaller(aContext(undefined).context);
    const sent = { waiting: 'waiting-1', browserSecret: 'secret-1' };

    await expect(caller.oauth.waiting(sent)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe("a page follows its fleet's request changes through the gateway's API, to read itself again", () => {
  it('hears each change to its own fleet, and none of another fleet', async () => {
    const { context, changes } = aContext(PERSON_COOKIE);
    const stop = new AbortController();
    const followed = await gatewayRouter.createCaller(context, { signal: stop.signal }).requests.changes();
    const heard = followed[Symbol.asyncIterator]();
    const next = heard.next();
    await expect.poll(() => changes.listeners()).toBe(1);

    changes.publish({ fleetId: OTHER_FLEET_ID, topic: 'requests' });
    changes.publish({ fleetId: FLEET, topic: 'requests' });

    await expect(next).resolves.toEqual({ done: false, value: { fleetId: FLEET } });
    stop.abort();
  });

  it('stops following once the page goes', async () => {
    const { context, changes } = aContext(PERSON_COOKIE);
    const stop = new AbortController();
    const heard = (await gatewayRouter.createCaller(context, { signal: stop.signal }).requests.changes())[Symbol.asyncIterator]();
    const next = heard.next();
    await expect.poll(() => changes.listeners()).toBe(1);

    stop.abort();

    await expect(next).resolves.toMatchObject({ done: true });
    expect(changes.listeners()).toBe(0);
  });
});

describe("a person lists the requests they asked through the gateway's API (decision 0056: Your requests)", () => {
  it('answers them as the API answers To decide, its times as ISO text', async () => {
    const { context } = aContext(PERSON_COOKIE);

    await expect(gatewayRouter.createCaller(context).requests.mine()).resolves.toEqual([
      {
        ...ORDERBOT_REQUEST,
        state: 'denied',
        askedAt: '2026-10-20T09:00:00.000Z',
        expiresAt: '2026-10-27T09:00:00.000Z',
        decidedBy: { kind: 'account', accountId: 'acc-pieter' },
        decidedAt: '2026-10-21T09:00:00.000Z',
      },
    ]);
  });

  it('refuses any other actor: only an account asks', async () => {
    const { context } = aContext(ARGO_COOKIE);

    await expect(gatewayRouter.createCaller(context).requests.mine()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe("the web app's page asks which account it shows the fleet in its address as (H5)", () => {
  const signIns = fakeSharedSignIn({ tokens: new Map([[FLEET, { ...CHARLOTTE_ACCOUNT_TOKEN, endsAt: new Date('2099-01-01T00:00:00.000Z') }]]) });
  const accountInView = createAccountInView({ signIns, accountOf: createAccountOfSignIn({ signIns, clock: { now: () => new Date('2026-10-21T09:00:00.000Z') } }) });

  function asked(sent: { signIn?: string; fleetInView?: FleetId }, inView: { accountInView: Context['accountInView'] } = { accountInView }) {
    return gatewayRouter.createCaller({ ...aContext(undefined).context, ...sent, ...inView }).account.inView();
  }

  it('answers the account, its fleet and its scopes, never its token', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET })).resolves.toEqual({ kind: 'signedIn', fleetId: FLEET, accountId: 'acc-charlotte', scopes: ['fleet:read', 'gateway:approve'] });
  });

  it('answers the fleet to go to when the page names none', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN })).resolves.toEqual({ kind: 'goTo', fleetId: OTHER_FLEET_ID });
  });

  it('answers the app to go to where the account may not open the gateway (H9)', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN, fleetInView: OTHER_FLEET_ID })).resolves.toEqual({ kind: 'elsewhere', url: CONSOLE_URL });
  });

  it('refuses a browser with no shared sign-in, so the page signs it in', async () => {
    await expect(asked({ fleetInView: FLEET })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('says pagasae did not answer', async () => {
    const down = fakeSharedSignIn({ isAvailable: false });

    await expect(asked({ signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET }, { accountInView: createAccountInView({ signIns: down, accountOf: createAccountOfSignIn({ signIns: down, clock: { now: () => new Date() } }) }) })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('refuses where the gateway signs no one in to its pages', async () => {
    await expect(asked({ signIn: CHARLOTTE_SIGN_IN, fleetInView: FLEET }, { accountInView: undefined })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('a call whose input is wrong is told so in a sentence', () => {
  it('names the fields that are missing or wrong, never the raw validation', async () => {
    const input = encodeURIComponent(JSON.stringify({ client_id: 1 }));
    const answer = await fetchRequestHandler({
      endpoint: '/trpc',
      req: new Request(`http://gateway.test/trpc/oauth.authorization?input=${input}`),
      router: gatewayRouter,
      createContext: () => aContext(undefined).context,
    });

    const body: unknown = await answer.json();

    expect(body).toMatchObject({ error: { message: 'Check what you filled in: client_id is missing or wrong.' } });
  });
});
