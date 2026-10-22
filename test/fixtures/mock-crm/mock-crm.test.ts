import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMcpServers } from '../../../src/adapters/mcp/mcp-servers.js';
import { MOCK_CRM_BEARER, startMockCrm, type MockCrm } from './mock-crm.js';

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
