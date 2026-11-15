import type { AppPaletteGroup } from '@aeolus-fleet/common/rules';
import { describe, expect, it } from 'vitest';

import { bridgePaletteGroupsOf, ownPaletteOf } from './palette-groups';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const MCP_ADDRESS = 'https://gateway.aeolus-fleet.dev/mcp';

/** The console's group, as the gateway's server reads it from the console's list for the account (header-across-apps A2). */
const CONSOLE: AppPaletteGroup = {
  app: 'console',
  label: 'Console',
  entries: [
    { key: 'console:commission', label: 'Commission ship', keywords: ['ship'], icon: 'plus', href: `https://fleet.aeolus-fleet.dev/?commission=new&fleet=${FLEET}` },
    { key: 'console:overview', label: 'Fleet overview', keywords: [], icon: 'ship', href: `https://fleet.aeolus-fleet.dev/?fleet=${FLEET}` },
  ],
};
const ACCOUNT: AppPaletteGroup = {
  app: 'account',
  label: 'Account',
  entries: [{ key: 'account:rights', label: 'Your rights', keywords: [], icon: 'shield', href: 'https://account.aeolus-fleet.dev/rights' }],
};

const own = ownPaletteOf({ fleetId: FLEET, mcpAddress: MCP_ADDRESS });

/** What a palette shows for the query: each group's label and its entries' labels, in order. */
function shown(query: string) {
  const groups = bridgePaletteGroupsOf({ own, otherApps: [CONSOLE, ACCOUNT], query });
  return [...groups.own.map(({ label, entries }) => ({ label, entries: entries.map((entry) => entry.label) })), ...groups.others.map(({ label, entries }) => ({ label, entries: entries.map((entry) => entry.label) }))];
}

describe("Bridge's palette across apps (header-across-apps A2, M2; the approved sheet, Bridge typing \"fleet\")", () => {
  it("finds Bridge's own Your fleet under Go to first, then the console's Fleet overview under Console", () => {
    expect(shown('fleet')).toEqual([
      { label: 'Go to', entries: ['Your fleet'] },
      { label: 'Console', entries: ['Fleet overview'] },
    ]);
  });

  it('finds Copy MCP address by "mcp", among its own actions', () => {
    expect(shown('mcp')).toEqual([{ label: 'Actions', entries: ['Copy MCP address', 'Add outside party'] }]);
  });

  it("shows, with nothing typed, its own actions and pages, then each other app's entries under its name", () => {
    expect(shown('')).toEqual([
      { label: 'Actions', entries: ['Copy MCP address', 'Add outside party'] },
      { label: 'Go to', entries: ['Waiting on you', 'Stay aware', 'Messages', 'Done', 'Your fleet', 'Where things show', 'Outside parties'] },
      { label: 'Console', entries: ['Commission ship', 'Fleet overview'] },
      { label: 'Account', entries: ['Your rights'] },
    ]);
  });

  it('finds an entry by a word it is known by, in any case', () => {
    expect(shown('SHIP')).toEqual([{ label: 'Console', entries: ['Commission ship', 'Fleet overview'] }]);
  });

  it('shows nothing for what nothing matches', () => {
    expect(shown('harbour')).toEqual([]);
  });

  it("opens its own pages in the fleet in view, and copies the gateway's MCP address", () => {
    const entries = own.flatMap((group) => group.entries);

    expect(entries.map((entry) => entry.copyText ?? entry.href)).toEqual([
      'https://gateway.aeolus-fleet.dev/mcp',
      `/outside-parties/add?fleet=${FLEET}`,
      `/bridge?fleet=${FLEET}`,
      `/bridge/stay-aware?fleet=${FLEET}`,
      `/bridge/messages?fleet=${FLEET}`,
      `/bridge/done?fleet=${FLEET}`,
      `/bridge/fleet?fleet=${FLEET}`,
      `/bridge/settings/routing?fleet=${FLEET}`,
      `/outside-parties?fleet=${FLEET}`,
    ]);
  });
});
