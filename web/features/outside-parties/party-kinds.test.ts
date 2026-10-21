import { describe, expect, it } from 'vitest';

import { countsOf } from './party-kinds';

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
