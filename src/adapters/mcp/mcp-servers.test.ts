import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MOCK_CRM_BEARER, MOCK_CRM_CLIENT, startMockCrm, type MockCrm } from '../../../test/fixtures/mock-crm/mock-crm.js';
import type { McpServerConnection } from '../../core/mcp-out/ports.js';
import { createMcpServers } from './mcp-servers.js';

const TIMEOUT_MS = 5_000;

let crm: MockCrm;
const servers = createMcpServers();

beforeEach(async () => {
  crm = await startMockCrm({ slowToolMs: 50 });
});

afterEach(async () => {
  await crm.close();
});

function withBearer(token = MOCK_CRM_BEARER): McpServerConnection {
  return { url: crm.url, credential: { kind: 'bearer', token } };
}

function withClientCredentials(clientSecret = MOCK_CRM_CLIENT.clientSecret): McpServerConnection {
  return { url: crm.url, credential: { kind: 'clientCredentials', clientId: MOCK_CRM_CLIENT.clientId, clientSecret, issuer: new URL(crm.url).origin } };
}

describe('listing an outside MCP server\'s tools', () => {
  it('lists every tool with its fields and annotations', async () => {
    const listed = await servers.listTools(withBearer());
    expect(listed.isOk && listed.value.map((tool) => tool.name)).toEqual([
      'list_contacts',
      'create_contact',
      'list_deals',
      'create_deal',
      'forecast_revenue',
      'sync_ledger',
    ]);
  });

  it('keeps a tool\'s title, description, input schema and annotations', async () => {
    const listed = await servers.listTools(withBearer());
    expect(listed.isOk && listed.value.find((tool) => tool.name === 'create_deal')).toEqual({
      name: 'create_deal',
      title: 'Create a deal',
      description: 'Opens a deal for a contact; each call opens one.',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { contactId: { type: 'string' }, title: { type: 'string' }, amount: { type: 'number' } },
        required: ['contactId', 'title', 'amount'],
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    });
  });

  it('signs in with OAuth client credentials', async () => {
    const listed = await servers.listTools(withClientCredentials());
    expect(listed.isOk && listed.value.length).toBe(6);
  });

  it('answers unreachable when the server refuses the credential', async () => {
    const listed = await servers.listTools(withBearer('not-the-token'));
    expect(!listed.isOk && listed.error.kind).toBe('unreachable');
  });

  it('answers unreachable when nothing listens', async () => {
    await crm.close();
    const listed = await servers.listTools(withBearer());
    expect(!listed.isOk && listed.error.kind).toBe('unreachable');
  });
});

describe('calling a tool of an outside MCP server (interop 5.2)', () => {
  it('answers the result the tool gave', async () => {
    const outcome = await servers.callTool(withBearer(), { name: 'list_deals', arguments: { contactId: 'c1' }, timeoutMs: TIMEOUT_MS });
    expect(outcome).toEqual({
      kind: 'answered',
      result: {
        content: [{ type: 'text', text: JSON.stringify([{ id: 'd1', contactId: 'c1', title: 'Analytical engine', amount: 1200 }]) }],
        structuredContent: { deals: [{ id: 'd1', contactId: 'c1', title: 'Analytical engine', amount: 1200 }] },
        isError: false,
      },
    });
  });

  it('answers an error result as an answer: the call ran and its error is the result', async () => {
    const outcome = await servers.callTool(withBearer(), { name: 'sync_ledger', arguments: {}, timeoutMs: TIMEOUT_MS });
    expect(outcome).toEqual({
      kind: 'answered',
      result: { content: [{ type: 'text', text: 'The ledger is unreachable: connection refused' }], isError: true },
    });
  });

  it('answers a tool the server does not know as an error result, which ran nothing', async () => {
    const outcome = await servers.callTool(withBearer(), { name: 'delete_everything', arguments: {}, timeoutMs: TIMEOUT_MS });
    expect(outcome.kind === 'answered' && outcome.result.isError).toBe(true);
  });

  it('runs the call once', async () => {
    await servers.callTool(withBearer(), { name: 'create_contact', arguments: { name: 'Grace Hopper', email: 'grace@example.com' }, timeoutMs: TIMEOUT_MS });
    expect(crm.calls.get('create_contact')).toBe(1);
  });

  it('waits for the slow tool within its timeout', async () => {
    const outcome = await servers.callTool(withBearer(), { name: 'forecast_revenue', arguments: {}, timeoutMs: TIMEOUT_MS });
    expect(outcome).toEqual({ kind: 'answered', result: { content: [{ type: 'text', text: '{"total":1200}' }], structuredContent: { total: 1200 }, isError: false } });
  });

  it('signs in with OAuth client credentials', async () => {
    const outcome = await servers.callTool(withClientCredentials(), { name: 'list_contacts', arguments: {}, timeoutMs: TIMEOUT_MS });
    expect(outcome.kind).toBe('answered');
  });

  it('answers unanswered when the answer does not come within the timeout: the call may have run', async () => {
    crm.isSlowToolHeld = true;
    const outcome = await servers.callTool(withBearer(), { name: 'forecast_revenue', arguments: {}, timeoutMs: 300 });
    expect({ kind: outcome.kind, ran: crm.calls.get('forecast_revenue') }).toEqual({ kind: 'unanswered', ran: 1 });
  });

  it('answers notSent when the server refuses the credential, and nothing ran', async () => {
    const outcome = await servers.callTool(withBearer('not-the-token'), { name: 'create_contact', arguments: { name: 'X', email: 'x@example.com' }, timeoutMs: TIMEOUT_MS });
    expect({ kind: outcome.kind, ran: crm.calls.get('create_contact') }).toEqual({ kind: 'notSent', ran: undefined });
  });

  it('answers notSent when the client credentials are refused', async () => {
    const outcome = await servers.callTool(withClientCredentials('wrong-secret'), { name: 'list_contacts', arguments: {}, timeoutMs: TIMEOUT_MS });
    expect(outcome.kind).toBe('notSent');
  });

  it('answers notSent when nothing listens', async () => {
    await crm.close();
    const outcome = await servers.callTool(withBearer(), { name: 'list_contacts', arguments: {}, timeoutMs: TIMEOUT_MS });
    expect(outcome.kind).toBe('notSent');
  });
});
