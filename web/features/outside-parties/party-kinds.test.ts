import { describe, expect, it } from 'vitest';

import { countsOf, inListOrder } from './party-kinds';

const aServer = { kind: 'mcpServer' } as const;
const aClient = { kind: 'mcpClient' } as const;

describe("an outside parties list's counts", () => {
  it('counts the parties per side and per protocol', () => {
    expect(countsOf([aServer, aServer, aClient])).toEqual({ total: 3, sides: { server: 2, client: 1 }, protocols: [{ protocol: 'MCP', count: 3 }] });
  });

  it('counts no party as none on either side, and no protocol', () => {
    expect(countsOf([])).toEqual({ total: 0, sides: { server: 0, client: 0 }, protocols: [] });
  });
});

describe("an outside parties list's order (design/bridge-navigation)", () => {
  it('lists MCP servers, then MCP clients, then A2A agents, then A2A clients, keeping the order within a kind', () => {
    const parties = [
      { kind: 'a2aAgent', name: 'research-agent' },
      { kind: 'mcpClient', name: 'chatgpt' },
      { kind: 'mcpServer', name: 'attio' },
      { kind: 'a2aClient', name: 'partner-bot' },
      { kind: 'mcpClient', name: 'claude-ai' },
      { kind: 'mcpServer', name: 'github' },
    ] as const;

    expect(inListOrder(parties).map(({ name }) => name)).toEqual(['attio', 'github', 'chatgpt', 'claude-ai', 'research-agent', 'partner-bot']);
  });
});
