import type { PaletteList } from '@aeolus-fleet/common';

import { BRIDGE_FLEET_PATH } from '../../../web/features/bridge/fleet/paths';
import { BRIDGE_DONE_PATH, BRIDGE_MESSAGES_PATH, BRIDGE_PATH, BRIDGE_ROUTING_PATH, BRIDGE_STAY_AWARE_PATH } from '../../../web/features/bridge/paths';
import { ADD_SERVER_PATH, OUTSIDE_PARTIES_PATH } from '../../../web/features/outside-parties/paths';

export type PaletteListEntry = PaletteList['entries'][number];

/** Bridge's pages in its navigation's order, each with where it opens and its icon. */
const PAGES: readonly { key: string; label: string; path: string; icon: PaletteListEntry['icon'] }[] = [
  { key: 'home', label: 'Waiting on you', path: BRIDGE_PATH, icon: 'inbox' },
  { key: 'stay-aware', label: 'Stay aware', path: BRIDGE_STAY_AWARE_PATH, icon: 'activity' },
  { key: 'messages', label: 'Messages', path: BRIDGE_MESSAGES_PATH, icon: 'mail' },
  { key: 'done', label: 'Done', path: BRIDGE_DONE_PATH, icon: 'app' },
  { key: 'fleet', label: 'Your fleet', path: BRIDGE_FLEET_PATH, icon: 'ship' },
  { key: 'routing', label: 'Where things show', path: BRIDGE_ROUTING_PATH, icon: 'settings' },
  { key: 'outside-parties', label: 'Outside parties', path: OUTSIDE_PARTIES_PATH, icon: 'network' },
];

/**
 * The gateway's palette list (aeolus-fleet, docs/design/header-across-apps.md,
 * A1 and A3; header design H4): Copy MCP address, the action Add outside
 * party, and every page of Bridge's navigation, with no data: no ships, no
 * parties. It asks no right beyond opening the gateway in the fleet: each
 * page says what it allows. Bridge's own palette offers the same entries.
 */
export function gatewayPaletteListOf({ mcpAddress }: { mcpAddress: string }): PaletteList & { app: 'gateway' } {
  return {
    app: 'gateway',
    entries: [
      { kind: 'copy', key: 'copy-mcp-address', label: 'Copy MCP address', value: mcpAddress, keywords: ['mcp', 'address', 'connect', 'chat'], rights: [], icon: 'copy' },
      { kind: 'action', key: 'add-outside-party', label: 'Add outside party', path: ADD_SERVER_PATH, keywords: ['mcp', 'server', 'add'], rights: [], icon: 'plus' },
      ...PAGES.map((page): PaletteListEntry => ({ kind: 'page', ...page, keywords: [], rights: [] })),
    ],
  };
}
