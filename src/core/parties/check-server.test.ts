import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeMcpServers } from '../../../test/support/mcp-out-fakes.js';
import { createCheckServer } from './check-server.js';

const SERVER = { url: 'https://mcp.linear.app/mcp', credential: { kind: 'bearer' as const, token: 'linear-token' } };

let servers: ReturnType<typeof fakeMcpServers>;
let isOn: boolean;
let checkServer: ReturnType<typeof createCheckServer>;

beforeEach(() => {
  servers = fakeMcpServers([
    { name: 'list_issues', description: 'List issues by team, state or assignee', inputSchema: { type: 'object' } },
    { name: 'get_issue', inputSchema: { type: 'object' } },
  ]);
  isOn = true;
  checkServer = createCheckServer({ servers, servesOutsideParties: () => Promise.resolve(isOn) });
});

describe('checking an outside MCP server before it is added (F10)', () => {
  it('answers the tools the server lists, each with its name and short description, keeping nothing', async () => {
    const checked = await checkServer({ fleetId: FLEET_ID, ...SERVER });

    expect(checked).toEqual({
      isOk: true,
      value: { tools: [{ name: 'list_issues', description: 'List issues by team, state or assignee' }, { name: 'get_issue' }] },
    });
    expect(servers.listedWith).toEqual([SERVER]);
  });

  it('says the server could not be listed, and why', async () => {
    servers.state.isReachable = false;

    const checked = await checkServer({ fleetId: FLEET_ID, ...SERVER });

    expect(checked).toMatchObject({ isOk: false, error: { kind: 'SERVER_UNREACHABLE', message: 'The MCP server could not be listed: connect ECONNREFUSED' } });
  });

  it("refuses while the fleet's outside parties are off, sending the credential nowhere", async () => {
    isOn = false;

    const checked = await checkServer({ fleetId: FLEET_ID, ...SERVER });

    expect(checked).toMatchObject({ isOk: false, error: { kind: 'OUTSIDE_PARTIES_OFF' } });
    expect(servers.listedWith).toEqual([]);
  });
});
