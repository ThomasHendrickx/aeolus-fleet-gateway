import { paletteListSchema } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { gatewayPaletteListOf } from './palette-list';

const MCP_ADDRESS = 'https://gateway.aeolus-fleet.dev/mcp';

describe("the gateway's palette list (header-across-apps A1, A3; header design H4)", () => {
  it('offers Copy MCP address first, copying the address outside MCP clients connect to', () => {
    const [first] = gatewayPaletteListOf({ mcpAddress: MCP_ADDRESS }).entries;

    expect(first).toMatchObject({ kind: 'copy', label: 'Copy MCP address', value: 'https://gateway.aeolus-fleet.dev/mcp' });
  });

  it("offers Add outside party, then every page of Bridge's navigation, in its order, where each opens", () => {
    const opened = gatewayPaletteListOf({ mcpAddress: MCP_ADDRESS }).entries.flatMap((entry) => (entry.kind === 'copy' ? [] : [{ kind: entry.kind, label: entry.label, path: entry.path }]));

    expect(opened).toEqual([
      { kind: 'action', label: 'Add outside party', path: '/outside-parties/add' },
      { kind: 'page', label: 'Waiting on you', path: '/bridge' },
      { kind: 'page', label: 'Stay aware', path: '/bridge/stay-aware' },
      { kind: 'page', label: 'Messages', path: '/bridge/messages' },
      { kind: 'page', label: 'Done', path: '/bridge/done' },
      { kind: 'page', label: 'Your fleet', path: '/bridge/fleet' },
      { kind: 'page', label: 'Where things show', path: '/bridge/settings/routing' },
      { kind: 'page', label: 'Outside parties', path: '/outside-parties' },
    ]);
  });

  it('finds Copy MCP address by "mcp"', () => {
    const [first] = gatewayPaletteListOf({ mcpAddress: MCP_ADDRESS }).entries;

    expect(first?.keywords).toContain('mcp');
  });

  it('asks no right of the fleet beyond opening the gateway: each page says what it allows', () => {
    expect(gatewayPaletteListOf({ mcpAddress: MCP_ADDRESS }).entries.map((entry) => entry.rights)).toEqual([[], [], [], [], [], [], [], [], []]);
  });

  it('reads as a palette list of the gateway', () => {
    const list = gatewayPaletteListOf({ mcpAddress: MCP_ADDRESS });

    expect(paletteListSchema.parse(list)).toEqual({ ...list, app: 'gateway' });
  });
});
