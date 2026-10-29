import { beforeEach, describe, expect, it } from 'vitest';

import { fakeShipReads, FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { fakeCallSender } from '../../../test/support/mcp-in-fakes.js';
import { aPushedDelivery, CALLER_SHIP_ID, fakeMcpServers, fakeProxyShipCrew, memoryCalls, memoryToolMarks } from '../../../test/support/mcp-out-fakes.js';
import { memoryPartyStore, memoryScopeRequirements, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import { aPartyGrant, anAttioParty, fakePartySignIns, JORIS_SHIP_ID, MATHILDE_SHIP_ID, memoryPartyGrants, memorySignInNotices } from '../../../test/support/party-grant-fakes.js';
import { createCheckRequiredScopes } from '../parties/check-required-scopes.js';
import type { McpServerParty } from '../parties/party.js';
import { createCallGrantOf } from '../party-grants/call-grant.js';
import { createRefreshGrant } from '../party-grants/refresh-grant.js';
import { createTellSignInNeeded } from '../party-grants/tell-sign-in-needed.js';
import { createGrantCalls } from './grant-calls.js';
import { createHandCall } from './hand-call.js';

const CRM: McpServerParty = {
  fleetId: FLEET_ID,
  name: 'crm',
  kind: 'mcpServer',
  url: 'https://crm.example.com/mcp',
  credential: { kind: 'bearer', token: 'crm-token' },
  concurrencyLimit: 4,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_proxy',
  requestId: 'a-1',
  requestHash: 'h',
  approvedAt: new Date('2026-10-18T14:00:00.000Z'),
  toolSwitches: null,
};

const DEALS = { content: [{ type: 'text', text: '[]' }], structuredContent: { deals: [] }, isError: false };
/** A reply's payload, read back. */
const parsed = (payload: string): unknown => JSON.parse(payload);
const MAY_HAVE_RUN = 'The call may have run; its answer was lost. Check the outside system, then resend or dismiss.';
const NOW = new Date('2026-10-28T14:30:00.000Z');

/** The page a person signs in to a party on, as the gateway's address names it. */
const pageUrlOf = (fleetId: string, party: string) => `https://gateway.example.com/outside-parties/${party}?fleet=${fleetId}`;

let crew: ReturnType<typeof fakeProxyShipCrew>;
let servers: ReturnType<typeof fakeMcpServers>;
let calls: ReturnType<typeof memoryCalls>;
let marks: ReturnType<typeof memoryToolMarks>;
let parties: ReturnType<typeof memoryPartyStore>;
let requirements: ReturnType<typeof memoryScopeRequirements>;
let ships: ReturnType<typeof fakeShipReads>;
let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;
let sender: ReturnType<typeof fakeCallSender>;
let handCall: ReturnType<typeof createHandCall>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CRM);
  crew = fakeProxyShipCrew();
  servers = fakeMcpServers();
  servers.state.outcome = { kind: 'answered', result: DEALS };
  calls = memoryCalls();
  marks = memoryToolMarks();
  requirements = memoryScopeRequirements();
  ships = fakeShipReads();
  ships.state.ships.set(CALLER_SHIP_ID, { name: 'lead-scout', scopes: ['messages:send', 'crm:read-leads'] });
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  const checkScopes = createCheckRequiredScopes({ connections, door: ships.door });
  grants = memoryPartyGrants();
  attio = fakePartySignIns();
  sender = fakeCallSender();
  const clock = { now: () => NOW };
  const grantCalls = createGrantCalls({
    callGrantOf: createCallGrantOf({ connections, door: ships.door, grants }),
    refreshGrant: createRefreshGrant({ signIns: attio.signIns, grants, clock }),
    tellSignInNeeded: createTellSignInNeeded({ notices: memorySignInNotices(), connections, sender, newNoticeId: () => 'notice-1', pageUrlOf }),
    servers,
    grants,
    clock,
    pageUrlOf,
  });
  handCall = createHandCall({ crew, servers, calls, marks, parties, requirements, checkScopes, grantCalls, timeoutMs: 60_000 });
});

describe('the gateway refuses a call to a tool not switched on for the party (aeolus-fleet#1151)', () => {
  const NOT_ENABLED = { content: [{ type: 'text', text: 'tool not enabled for this party' }], isError: true };

  it('replies a plain error, reports it handled, and never reaches the server', async () => {
    await parties.switchTools({ fleetId: FLEET_ID, name: 'crm' }, { listed: ['list_deals'], switched: new Map([['list_deals', false]]) });

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called).toEqual([]);
    expect(crew.sent().map((sent) => parsed(sent.payload))).toEqual([NOT_ENABLED]);
    expect(crew.log.map(([call]) => call)).toEqual(['send', 'ack', 'handled']);
  });

  it('refuses a tool the server listed after its switches were kept', async () => {
    await parties.switchTools({ fleetId: FLEET_ID, name: 'crm' }, { listed: ['list_contacts'], switched: new Map() });

    await handCall({ party: CRM, delivery: aPushedDelivery() });

    expect(servers.called).toEqual([]);
  });

  it('calls a tool switched on', async () => {
    await parties.switchTools({ fleetId: FLEET_ID, name: 'crm' }, { listed: ['list_contacts'], switched: new Map([['list_deals', true]]) });

    await handCall({ party: CRM, delivery: aPushedDelivery() });

    expect(servers.called.map(({ call }) => call.name)).toEqual(['list_deals']);
  });
});

describe('the gateway refuses a call from a ship that lacks a scope the tool needs (gateway scopes 4.2)', () => {
  const requireOfListDeals = (scopes: string[]) => requirements.change({ fleetId: FLEET_ID, name: 'crm' }, { version: 0, tools: new Map([['list_deals', scopes]]) });

  it('replies a tool error naming what is missing, reports it handled, and never reaches the server', async () => {
    await requireOfListDeals(['crm:write-leads']);

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called).toEqual([]);
    expect(crew.sent().map((sent) => parsed(sent.payload))).toEqual([{ content: [{ type: 'text', text: 'list_deals needs crm:write-leads, which lead-scout does not hold' }], isError: true }]);
    expect(crew.log.map(([call]) => call)).toEqual(['send', 'ack', 'handled']);
  });

  it('refuses a ship that holds the tool\'s own scope but not the party\'s', async () => {
    await requirements.change({ fleetId: FLEET_ID, name: 'crm' }, { version: 0, party: ['crm:use'], tools: new Map([['list_deals', ['crm:read-leads']]]) });

    await handCall({ party: CRM, delivery: aPushedDelivery() });

    expect(servers.called).toEqual([]);
  });

  it('calls the tool for a ship holding every scope it needs', async () => {
    await requireOfListDeals(['crm:read-leads']);

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called.map(({ call }) => call.name)).toEqual(['list_deals']);
  });

  it('refuses a call whose scope was revoked while it waited: the check is at hand-over', async () => {
    await requireOfListDeals(['crm:read-leads']);
    ships.state.ships.set(CALLER_SHIP_ID, { name: 'lead-scout', scopes: ['messages:send'] });

    await handCall({ party: CRM, delivery: aPushedDelivery() });

    expect(servers.called).toEqual([]);
  });

  it('calls a tool whose requirement was removed while the call waited', async () => {
    await requireOfListDeals(['crm:write-leads']);
    await requirements.change({ fleetId: FLEET_ID, name: 'crm' }, { version: 1, tools: new Map([['list_deals', []]]) });

    await handCall({ party: CRM, delivery: aPushedDelivery() });

    expect(servers.called.map(({ call }) => call.name)).toEqual(['list_deals']);
  });

  it('hands nothing and tries again when core does not answer the scope read: never called unchecked', async () => {
    await requireOfListDeals(['crm:read-leads']);
    ships.state.isAnswering = false;

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'again' });

    expect({ called: servers.called, crew: crew.log }).toEqual({ called: [], crew: [] });
  });

  it('answers a tool switched off as not enabled, before any scope is read', async () => {
    await requireOfListDeals(['crm:write-leads']);
    await parties.switchTools({ fleetId: FLEET_ID, name: 'crm' }, { listed: ['list_deals'], switched: new Map([['list_deals', false]]) });

    await handCall({ party: CRM, delivery: aPushedDelivery() });

    expect(ships.state.reads).toEqual([]);
  });
});

describe('the gateway hands a call to its outside MCP server (interop 5.2)', () => {
  it('hands it over, calls the tool with the arguments and the vault credential, and replies with the result naming the request', async () => {
    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called).toEqual([{ connection: { url: CRM.url, credential: CRM.credential }, call: { name: 'list_deals', arguments: { contactId: 'c1' }, timeoutMs: 60_000 } }]);
    expect(crew.log).toEqual([
      ['handed', { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01', handOverNumber: 1, channel: 'mcp' }],
      [
        'send',
        {
          to: CALLER_SHIP_ID,
          inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank9m01',
          contentType: 'application/vnd.aeolus.mcp-result+json; name=list_deals',
          payload: JSON.stringify(DEALS),
          idempotencyKey: 'mcp-result:msg_01m3tbfspe96yf1rnr4ank9m01',
        },
      ],
      ['ack', 'dlv_01m3tbfspe96yf1rnr4ank9d01'],
      ['handled', 'dlv_01m3tbfspe96yf1rnr4ank9d01'],
    ]);
  });

  it('calls with the crew token of the proxy ship', async () => {
    await handCall({ party: CRM, delivery: aPushedDelivery() });

    expect(new Set(crew.crewTokens)).toEqual(new Set(['aeolus_ct_v1_proxy']));
  });

  it('replies with an error result and reports it handled: the call ran and its error is the answer', async () => {
    const failed = { content: [{ type: 'text', text: 'The ledger is unreachable' }], isError: true };
    servers.state.outcome = { kind: 'answered', result: failed };

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'handled' });
    expect(crew.sent().map((sent) => sent.payload)).toEqual([JSON.stringify(failed)]);
  });

  it('keeps the answer before it replies, so a crash after the call repeats no call', async () => {
    servers.state.outcome = { kind: 'answered', result: DEALS };
    crew.state.isSendAnswering = false;

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'again' });
    crew.state.isSendAnswering = true;
    await expect(handCall({ party: CRM, delivery: aPushedDelivery({ state: 'handed', handOverNumber: 1 }) })).resolves.toEqual({ kind: 'handled' });

    expect({ called: servers.called.length, replies: crew.sent().length }).toEqual({ called: 1, replies: 1 });
  });

  it('answers again when the call was not sent, which ran nothing, acknowledging nothing', async () => {
    servers.state.outcome = { kind: 'notSent', reason: 'connect ECONNREFUSED' };

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'again' });
    expect(crew.log.map(([call]) => call)).toEqual(['handed']);
  });

  it('hands a call that was not sent again with the next hand-over number, whatever its tool', async () => {
    servers.state.outcome = { kind: 'notSent', reason: 'connect ECONNREFUSED' };
    await handCall({ party: CRM, delivery: aPushedDelivery() });
    servers.state.outcome = { kind: 'answered', result: DEALS };

    await expect(handCall({ party: CRM, delivery: aPushedDelivery({ state: 'handed', handOverNumber: 1 }) })).resolves.toEqual({ kind: 'handled' });
    expect(crew.log.filter(([call]) => call === 'handed')).toEqual([
      ['handed', { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01', handOverNumber: 1, channel: 'mcp' }],
      ['handed', { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01', handOverNumber: 2, channel: 'mcp' }],
    ]);
  });

  it("answers again when an unanswered call's tool is marked repeatable", async () => {
    servers.state.outcome = { kind: 'unanswered', reason: 'timed out' };
    await marks.mark(FLEET_ID, { party: 'crm', tool: 'list_deals', isRepeatable: true });

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'again' });
  });

  it('reports an unanswered call not handled, saying it may have run, when its tool is not marked repeatable', async () => {
    servers.state.outcome = { kind: 'unanswered', reason: 'timed out' };

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'notHandled' });
    expect(crew.log.at(-1)).toEqual(['notHandled', { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01', reason: MAY_HAVE_RUN }]);
    expect(crew.sent()).toEqual([]);
  });

  it('reports a call handed before without an answer not handled, calling nothing, when its tool is not marked repeatable (the gateway stopped mid call)', async () => {
    await expect(handCall({ party: CRM, delivery: aPushedDelivery({ state: 'handed', handOverNumber: 1 }) })).resolves.toEqual({ kind: 'notHandled' });
    expect(servers.called).toEqual([]);
  });

  it('hands a call handed before without an answer again when its tool is marked repeatable', async () => {
    await marks.mark(FLEET_ID, { party: 'crm', tool: 'list_deals', isRepeatable: true });

    await expect(handCall({ party: CRM, delivery: aPushedDelivery({ state: 'handed', handOverNumber: 1 }) })).resolves.toEqual({ kind: 'handled' });
    expect(crew.log[0]).toEqual(['handed', { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01', handOverNumber: 2, channel: 'mcp' }]);
  });

  it('never calls again a call it judged may have run, though the fleet refused the report', async () => {
    servers.state.outcome = { kind: 'unanswered', reason: 'timed out' };
    crew.state.notHandledRefusal = { code: 'CONFLICT', message: 'A delivery never handed once more is refused' };
    await handCall({ party: CRM, delivery: aPushedDelivery() });

    await expect(handCall({ party: CRM, delivery: aPushedDelivery({ state: 'handed', handOverNumber: 1 }) })).resolves.toEqual({ kind: 'notHandled' });
    expect({ called: servers.called.length, reports: crew.log.filter(([call]) => call === 'notHandled').length }).toEqual({ called: 1, reports: 2 });
  });

  it('stops at the fifth attempt, which the fleet answers undeliverable, calling nothing', async () => {
    crew.state.handedState = 'undeliverable';
    await marks.mark(FLEET_ID, { party: 'crm', tool: 'list_deals', isRepeatable: true });

    await expect(handCall({ party: CRM, delivery: aPushedDelivery({ state: 'handed', handOverNumber: 4 }) })).resolves.toEqual({ kind: 'undeliverable' });
    expect(servers.called).toEqual([]);
  });

  it('answers again while the fleet does not answer the hand-over, calling nothing', async () => {
    crew.state.handedRefusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'again' });
    expect(servers.called).toEqual([]);
  });
});

describe('a message that is no call the server can take', () => {
  it('replies how to call a tool to a message of another content type, calling nothing', async () => {
    await expect(handCall({ party: CRM, delivery: aPushedDelivery({ contentType: 'text/plain', payload: 'list my deals' }) })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called).toEqual([]);
    expect(crew.sent()).toEqual([
      {
        to: CALLER_SHIP_ID,
        inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank9m01',
        contentType: 'text/plain',
        payload: "crm takes only tool calls: send a capability's input type, application/vnd.aeolus.mcp-tool+json; name=<tool>, with the tool arguments as a JSON object.",
        idempotencyKey: 'mcp-result:msg_01m3tbfspe96yf1rnr4ank9m01',
      },
    ]);
  });

  it.each([
    ['not JSON', 'contactId=c1'],
    ['a JSON array', '["c1"]'],
  ])('replies an error result to arguments that are %s, calling nothing', async (_what, payload) => {
    await expect(handCall({ party: CRM, delivery: aPushedDelivery({ payload }) })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called).toEqual([]);
    expect(crew.sent().map((sent) => [sent.contentType, parsed(sent.payload)])).toEqual([
      ['application/vnd.aeolus.mcp-result+json; name=list_deals', { content: [{ type: 'text', text: 'The tool arguments must be a JSON object.' }], isError: true }],
    ]);
  });

  it('replies an error result in place of a result too large for a message', async () => {
    servers.state.outcome = { kind: 'answered', result: { content: [{ type: 'text', text: 'x'.repeat(70_000) }], isError: false } };

    await expect(handCall({ party: CRM, delivery: aPushedDelivery() })).resolves.toEqual({ kind: 'handled' });
    expect(crew.sent().map((sent) => parsed(sent.payload))).toEqual([
      { content: [{ type: 'text', text: 'The tool result is 70055 bytes as JSON, over the 65536 a message holds.' }], isError: true },
    ]);
  });
});

describe('a call to a server where each person signs in goes out under its asking ship\'s owner\'s grant (decision 0067)', () => {
  const ATTIO = anAttioParty();
  const RECORDS = { content: [{ type: 'text', text: 'records for acme' }], isError: false };
  const PAGE = `https://gateway.example.com/outside-parties/attio?fleet=${FLEET_ID}`;
  const SEARCH = aPushedDelivery({ contentType: 'application/vnd.aeolus.mcp-tool+json; name=search_records', payload: '{"query":"acme"}' });
  const UNAUTHORIZED = { kind: 'notSent', reason: 'HTTP 401', refusal: 'unauthorized' } as const;
  const mathildeOwns = () => ships.state.ships.set(CALLER_SHIP_ID, { name: 'lead-scout', scopes: ['messages:send'], owner: { shipId: MATHILDE_SHIP_ID, name: 'mathilde' } });
  const jorisOwns = () => ships.state.ships.set(CALLER_SHIP_ID, { name: 'lead-scout', scopes: ['messages:send'], owner: { shipId: JORIS_SHIP_ID, name: 'joris' } });
  const repliedTexts = () => crew.sent().map((sent) => parsed(sent.payload));
  const noSignIn = (person: string) => ({ content: [{ type: 'text', text: `${person}, who owns the calling ship, has no working sign-in to attio: sign in on ${PAGE}, then call again.` }], isError: true });

  beforeEach(async () => {
    await parties.save(ATTIO);
    servers.state.outcome = { kind: 'answered', result: RECORDS };
    attio.state.refreshes.set('refresh-mathilde', { accessToken: 'access-2', refreshToken: 'refresh-2', expiresInSeconds: 3600 });
  });

  it("calls with the owner's access token and replies with the result (scenario 11)", async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant());

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called.map(({ connection }) => connection)).toEqual([{ url: ATTIO.url, credential: { kind: 'bearer', token: 'access-mathilde' } }]);
    expect(repliedTexts()).toEqual([RECORDS]);
  });

  it("sets when the owner's grant was last used", async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant());

    await handCall({ party: ATTIO, delivery: SEARCH });

    expect(grants.held).toEqual([aPartyGrant({ lastUsedAt: NOW })]);
  });

  it('answers at once an error result naming the owner\'s missing sign-in and the page, reaching no server (scenario 12, Q5)', async () => {
    jorisOwns();
    await grants.keep(aPartyGrant());

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called).toEqual([]);
    expect(repliedTexts()).toEqual([noSignIn('joris')]);
    expect(crew.log.map(([call]) => call)).toEqual(['send', 'ack', 'handled']);
  });

  it('tells the owner once, by a message to their person ship with the page (scenario 12, 13, Q6, Q9)', async () => {
    jorisOwns();

    await handCall({ party: ATTIO, delivery: SEARCH });
    await handCall({ party: ATTIO, delivery: aPushedDelivery({ ...SEARCH, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d02', messageId: 'msg_01m3tbfspe96yf1rnr4ank9m02' }) });

    expect(sender.sent).toMatchObject([{ to: JORIS_SHIP_ID, contentType: 'text/plain' }]);
    expect(sender.sent[0]?.payload).toContain(PAGE);
  });

  it('answers a ship argo owns an error result saying no person can sign in for it, telling nobody (scenario 14, Q10)', async () => {
    ships.state.ships.set(CALLER_SHIP_ID, { name: 'lead-scout', scopes: ['messages:send'], owner: { shipId: 'shp_01m3tbfspe96yf1rnr4ank9arg', name: 'argo' } });

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called).toEqual([]);
    expect(repliedTexts()).toEqual([{ content: [{ type: 'text', text: 'No person can sign in to attio for lead-scout, which argo owns: it calls attio once a person owns it.' }], isError: true }]);
    expect(sender.sent).toEqual([]);
  });

  it('lets a call through under a grant signed in while it waited: the grant is read at hand-over (scenario 15)', async () => {
    jorisOwns();
    await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', accessToken: 'access-joris', outsideAccount: { subject: 'sub-2', name: null } }));

    await handCall({ party: ATTIO, delivery: SEARCH });

    expect(servers.called.map(({ connection }) => connection.credential)).toEqual([{ kind: 'bearer', token: 'access-joris' }]);
  });

  it('hands nothing and tries again when core does not answer the owner read: never called without its grant (scenario 16)', async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant());
    ships.state.isAnswering = false;

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'again' });

    expect(servers.called).toEqual([]);
    expect(crew.log).toEqual([]);
  });

  it('refreshes the grant once when the server refuses the access token 401, and calls again with the new one (scenario 18)', async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant());
    servers.state.outcomes = [UNAUTHORIZED];

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called.map(({ connection }) => connection.credential)).toEqual([
      { kind: 'bearer', token: 'access-mathilde' },
      { kind: 'bearer', token: 'access-2' },
    ]);
    expect(repliedTexts()).toEqual([RECORDS]);
    expect(grants.held).toMatchObject([{ accessToken: 'access-2', refreshToken: 'refresh-2' }]);
  });

  it("answers Q5's error result at a second 401, refreshing once, and tells the owner (scenario 18)", async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant());
    servers.state.outcomes = [UNAUTHORIZED, UNAUTHORIZED];

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'handled' });

    expect(servers.called).toHaveLength(2);
    expect(attio.state.refreshed).toHaveLength(1);
    expect(repliedTexts()).toEqual([noSignIn('mathilde')]);
    expect(sender.sent).toMatchObject([{ to: MATHILDE_SHIP_ID }]);
  });

  it("answers Q5's error result when the authorization server refuses the refresh, and tells the owner", async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant());
    attio.state.refreshes.clear();
    servers.state.outcomes = [UNAUTHORIZED];

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'handled' });

    expect(repliedTexts()).toEqual([noSignIn('mathilde')]);
    expect(sender.sent).toMatchObject([{ to: MATHILDE_SHIP_ID }]);
  });

  it("answers Q5's error result at a 401 under a grant with no refresh token", async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant({ refreshToken: null }));
    servers.state.outcomes = [UNAUTHORIZED];

    await handCall({ party: ATTIO, delivery: SEARCH });

    expect(repliedTexts()).toEqual([noSignIn('mathilde')]);
  });

  it('hands the call again when the authorization server does not answer the refresh: nothing ran (L27)', async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant());
    attio.state.failure = { kind: 'unreachable', reason: 'connect ECONNREFUSED' };
    servers.state.outcomes = [UNAUTHORIZED];

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'again' });

    expect(grants.held).toEqual([aPartyGrant()]);
    expect(crew.sent()).toEqual([]);
  });

  it('answers an error result naming the page to sign in again on when the server refuses the call 403 insufficient_scope, keeping the grant (scenario 23)', async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant());
    servers.state.outcomes = [{ kind: 'notSent', reason: 'HTTP 403', refusal: 'insufficientScope' }];

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'handled' });

    expect(repliedTexts()).toEqual([{ content: [{ type: 'text', text: `attio refused the call: the sign-in of mathilde, who owns the calling ship, lacks a scope it needs. Sign in again on ${PAGE}, then call again.` }], isError: true }]);
    expect(grants.held).toEqual([aPartyGrant()]);
    expect(attio.state.refreshed).toEqual([]);
    expect(sender.sent).toEqual([]);
  });

  it('keeps the error result before it replies, so a restart replies it again and calls nothing, though the owner signed in meanwhile', async () => {
    jorisOwns();
    crew.state.isSendAnswering = false;
    await handCall({ party: ATTIO, delivery: SEARCH });
    crew.state.isSendAnswering = true;
    await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', accessToken: 'access-joris', outsideAccount: { subject: 'sub-2', name: null } }));

    await expect(handCall({ party: ATTIO, delivery: SEARCH })).resolves.toEqual({ kind: 'handled' });

    expect(repliedTexts()).toEqual([noSignIn('joris')]);
    expect(servers.called).toEqual([]);
  });

  it('replies again after a restart without calling again, once the server answered under the grant', async () => {
    mathildeOwns();
    await grants.keep(aPartyGrant());
    crew.state.isSendAnswering = false;
    await handCall({ party: ATTIO, delivery: SEARCH });
    crew.state.isSendAnswering = true;

    await handCall({ party: ATTIO, delivery: { ...SEARCH, state: 'handed', handOverNumber: 1 } });

    expect(servers.called).toHaveLength(1);
    expect(repliedTexts()).toEqual([RECORDS]);
  });
});
