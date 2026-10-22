import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMcpServers } from '../../../src/adapters/mcp/mcp-servers.js';
import { MOCK_CRM_BEARER, MOCK_CRM_CLIENT, startMockCrm, type MockCrm } from './mock-crm.js';

const TIMEOUT_MS = 5_000;

let crm: MockCrm;
const servers = createMcpServers();

beforeEach(async () => {
  crm = await startMockCrm();
});

afterEach(async () => {
  await crm.close();
});

async function called(name: string, toolArguments: Record<string, unknown>) {
  return servers.callTool({ url: crm.url, credential: { kind: 'bearer', token: MOCK_CRM_BEARER } }, { name, arguments: toolArguments, timeoutMs: TIMEOUT_MS });
}

describe('the mock CRM', () => {
  it('gets a contact by its id', async () => {
    const outcome = await called('get_contact', { id: 'c1' });
    const contact = { id: 'c1', name: 'Ada Lovelace', email: 'ada@example.com' };
    expect(outcome).toEqual({ kind: 'answered', result: { content: [{ type: 'text', text: JSON.stringify(contact) }], structuredContent: { contact }, isError: false } });
  });

  it('answers an error result for a contact it does not hold', async () => {
    const outcome = await called('get_contact', { id: 'c9' });
    expect(outcome).toEqual({ kind: 'answered', result: { content: [{ type: 'text', text: 'No contact has the id c9' }], isError: true } });
  });
});

describe("the mock CRM's token endpoint", () => {
  async function tokenFor(resource: string): Promise<Response> {
    const basic = Buffer.from(`${MOCK_CRM_CLIENT.clientId}:${MOCK_CRM_CLIENT.clientSecret}`).toString('base64');
    return fetch(`${new URL(crm.url).origin}/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', resource }),
    });
  }

  it('issues a token for its MCP endpoint as the resource', async () => {
    expect((await tokenFor(crm.url)).status).toBe(200);
  });

  it('refuses a token for another resource (RFC 8707)', async () => {
    const response = await tokenFor('http://127.0.0.1:1/mcp');
    expect({ status: response.status, body: await response.json() }).toEqual({ status: 400, body: { error: 'invalid_target' } });
  });
});
