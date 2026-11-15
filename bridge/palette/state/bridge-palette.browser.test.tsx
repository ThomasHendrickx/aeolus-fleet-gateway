import type { AppPaletteGroup } from '@aeolus-fleet/common/rules';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { ownPaletteOf } from '../services/palette-groups';
import { BridgePalette, type BridgePaletteEntries } from './bridge-palette';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';

/** The console's group, as the gateway's server reads it from the console's list for the account (header-across-apps A2). */
const CONSOLE: AppPaletteGroup = {
  app: 'console',
  label: 'Console',
  entries: [{ key: 'console:overview', label: 'Fleet overview', keywords: [], icon: 'ship', href: `https://fleet.aeolus-fleet.dev/?fleet=${FLEET}` }],
};

const ROUTER: AppRouterInstance = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: 'bridge-palette-test',
};

/** Bridge's palette entries, the other apps' as the server's read answers them. */
function entriesWith(otherApps: Promise<readonly AppPaletteGroup[]>): BridgePaletteEntries {
  return { own: ownPaletteOf({ fleetId: FLEET, mcpAddress: 'https://gateway.aeolus-fleet.dev/mcp' }), otherApps };
}

/** The palette open in Bridge, with these entries. */
function openPalette(entries: BridgePaletteEntries) {
  return (
    <AppRouterContext.Provider value={ROUTER}>
      <BridgePalette entries={entries} isOpen onOpenChange={() => undefined} />
    </AppRouterContext.Provider>
  );
}

describe("Bridge's palette, with the other apps' entries as the server reads them (header-across-apps A2)", () => {
  it("shows Bridge's own entries at once, and the console's once the server read them", async () => {
    let answer: (groups: readonly AppPaletteGroup[]) => void = () => undefined;
    await render(openPalette(entriesWith(new Promise((resolve) => (answer = resolve)))));

    await expect.element(page.getByRole('option', { name: 'Your fleet' })).toBeVisible();
    await expect.element(page.getByRole('option', { name: /Fleet overview/ })).not.toBeInTheDocument();
    answer([CONSOLE]);

    await expect.element(page.getByRole('option', { name: /Fleet overview/ })).toBeVisible();
  });

  it("keeps no earlier read's entries while the next read is still out", async () => {
    const screen = await render(openPalette(entriesWith(Promise.resolve([CONSOLE]))));
    await expect.element(page.getByRole('option', { name: /Fleet overview/ })).toBeVisible();

    await screen.rerender(openPalette(entriesWith(new Promise(() => undefined))));

    await expect.element(page.getByRole('option', { name: 'Your fleet' })).toBeVisible();
    await expect.element(page.getByRole('option', { name: /Fleet overview/ })).not.toBeInTheDocument();
  });
});
