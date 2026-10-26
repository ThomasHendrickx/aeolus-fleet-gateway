import { beforeEach, describe, expect, it } from 'vitest';

import { fakeShipReads, FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { aPushedDelivery, CALLER_SHIP_ID, fakeMcpServers, fakeProxyShipCrew, memoryCalls, memoryToolMarks } from '../../../test/support/mcp-out-fakes.js';
import { memoryPartyStore, memoryScopeRequirements, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import { createCheckRequiredScopes } from '../parties/check-required-scopes.js';
import type { McpServerParty } from '../parties/party.js';
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

let crew: ReturnType<typeof fakeProxyShipCrew>;
let servers: ReturnType<typeof fakeMcpServers>;
let calls: ReturnType<typeof memoryCalls>;
let marks: ReturnType<typeof memoryToolMarks>;
let parties: ReturnType<typeof memoryPartyStore>;
let requirements: ReturnType<typeof memoryScopeRequirements>;
let ships: ReturnType<typeof fakeShipReads>;
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
  handCall = createHandCall({ crew, servers, calls, marks, parties, requirements, checkScopes, timeoutMs: 60_000 });
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
