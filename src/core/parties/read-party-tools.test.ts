import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeMcpServers } from '../../../test/support/mcp-out-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { McpServerParty } from './party.js';
import { createReadPartyTools } from './read-party-tools.js';

const LINEAR: McpServerParty = {
  fleetId: FLEET_ID,
  name: 'linear',
  kind: 'mcpServer',
  url: 'https://mcp.linear.app/mcp',
  credential: { kind: 'bearer', token: 'linear-token' },
  concurrencyLimit: 4,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_proxy',
  requestId: 'a-1',
  requestHash: 'h',
  approvedAt: new Date('2026-10-18T14:00:00.000Z'),
};

let parties: ReturnType<typeof memoryPartyStore>;
let servers: ReturnType<typeof fakeMcpServers>;
let readPartyTools: ReturnType<typeof createReadPartyTools>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(LINEAR);
  servers = fakeMcpServers([
    { name: 'list_issues', description: 'List issues by team, state or assignee', inputSchema: { type: 'object' } },
    { name: 'get_issue', inputSchema: { type: 'object' } },
  ]);
  readPartyTools = createReadPartyTools({ parties, servers });
});

describe("an outside MCP server's tools, as it lists them now", () => {
  it('answers each tool by name and short description, asking the server with the credential the gateway keeps', async () => {
    const read = await readPartyTools({ fleetId: FLEET_ID, name: 'linear' });

    expect(read).toEqual({ isOk: true, value: { tools: [{ name: 'list_issues', description: 'List issues by team, state or assignee' }, { name: 'get_issue' }] } });
    expect(servers.listedWith).toEqual([{ url: LINEAR.url, credential: LINEAR.credential }]);
  });

  it('says the server could not be listed, and why', async () => {
    servers.state.isReachable = false;

    await expect(readPartyTools({ fleetId: FLEET_ID, name: 'linear' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SERVER_UNREACHABLE', message: 'The MCP server of linear could not be listed: connect ECONNREFUSED' } });
  });

  it('says there is no such server, for a name it does not know', async () => {
    await expect(readPartyTools({ fleetId: FLEET_ID, name: 'notion' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
    expect(servers.listedWith).toEqual([]);
  });
});
