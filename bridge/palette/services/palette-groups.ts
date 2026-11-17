import { paletteEntryMatches, type AppPaletteEntry, type AppPaletteGroup } from '@aeolus-fleet/common/rules';

import { inFleet } from '../../../web/lib/gateway-api/page-account';
import { gatewayPaletteListOf } from './palette-list';

/** One of Bridge's own groups: its actions, or the pages it goes to. */
export interface OwnPaletteGroup {
  readonly key: 'actions' | 'go-to';
  readonly label: string;
  readonly entries: readonly AppPaletteEntry[];
}

/**
 * Bridge's own entries, from the gateway's palette list (header-across-apps
 * A1): Actions (Copy MCP address, copying the gateway's MCP address, and Add
 * outside party), then Go to, each page in the fleet in view.
 */
export function ownPaletteOf({ fleetId, mcpAddress }: { fleetId: string; mcpAddress: string }): OwnPaletteGroup[] {
  const { entries } = gatewayPaletteListOf({ mcpAddress });
  const shown = (entry: (typeof entries)[number]): AppPaletteEntry => ({
    key: entry.key,
    label: entry.label,
    keywords: entry.keywords,
    icon: entry.icon,
    ...(entry.kind === 'copy' ? { copyText: entry.value } : { href: inFleet(entry.path, fleetId) }),
  });
  return [
    { key: 'actions', label: 'Actions', entries: entries.filter((entry) => entry.kind !== 'page').map(shown) },
    { key: 'go-to', label: 'Go to', entries: entries.filter((entry) => entry.kind === 'page').map(shown) },
  ];
}

/** Each group's entries that match what is typed, leaving out a group with none. */
function matching<Group extends { entries: readonly AppPaletteEntry[] }>(groups: readonly Group[], query: string): Group[] {
  return groups.map((group) => ({ ...group, entries: group.entries.filter((entry) => paletteEntryMatches(entry, query)) })).filter((group) => group.entries.length > 0);
}

/**
 * The palette's groups for what is typed (header-across-apps A2, M2): Bridge's
 * own first, then each other app the account may open, under its name.
 */
export function bridgePaletteGroupsOf({ own, otherApps, query }: { own: readonly OwnPaletteGroup[]; otherApps: readonly AppPaletteGroup[]; query: string }): { own: OwnPaletteGroup[]; others: AppPaletteGroup[] } {
  return { own: matching(own, query), others: matching(otherApps, query) };
}
