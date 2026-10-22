import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MOCK_CRM_CLIENT, startMockCrm, type MockCrm } from '../fixtures/mock-crm/mock-crm.js';
import { aMachineClient } from './machine-client.js';

let crm: MockCrm;

beforeEach(async () => {
  crm = await startMockCrm();
});

afterEach(async () => {
  await crm.close();
});

describe('a machine client', () => {
  it('signs in with client credentials and calls a tool at /mcp', async () => {
    const mcp = await aMachineClient(crm.url, MOCK_CRM_CLIENT);

    const result = await mcp.callTool({ name: 'get_contact', arguments: { id: 'c1' } });
    await mcp.close();

    expect(result.structuredContent).toEqual({ contact: { id: 'c1', name: 'Ada Lovelace', email: 'ada@example.com' } });
  });

  it('is refused with a secret that is not its own', async () => {
    await expect(aMachineClient(crm.url, { ...MOCK_CRM_CLIENT, clientSecret: 'not-the-secret' })).rejects.toThrow();
  });
});
