import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BridgeScreen } from '../services/shell';
import { BridgeSidebar, type ShellCounts } from './bridge-sidebar';

// Bridge's sidebar (home.html): Waiting on you, the basket while it holds
// any, Stay aware, Done and Your fleet, each with its count; then the
// settings; the person at the foot.

const COUNTS: ShellCounts = { waiting: 4, stayAware: 2, basket: 0, fleetAlerts: 1 };

function sidebarOf({ screen = 'home', counts = COUNTS, accountUrl = 'https://account.aeolus.test' }: { screen?: BridgeScreen; counts?: ShellCounts; accountUrl?: string | undefined } = {}): string {
  return renderToStaticMarkup(createElement(BridgeSidebar, { fleetId: 'flt_01', screen, counts, accountUrl, foot: null }));
}

/** Each entry of the sidebar by its key: where it leads, its words, whether it is the page in view. */
function entriesOf(markup: string): Record<string, { href: string | undefined; text: string; isCurrent: boolean }> {
  return Object.fromEntries(
    [...markup.matchAll(/<a([^>]*data-testid="bridge-side-([^"]*)"[^>]*)>(.*?)<\/a>/g)].map(([, attributes = '', key = '', inner = '']) => [
      key,
      { href: /href="([^"]*)"/.exec(attributes)?.[1]?.replaceAll('&amp;', '&'), text: inner.replace(/<[^>]*>/g, ''), isCurrent: attributes.includes('aria-current="page"') },
    ]),
  );
}

describe("Bridge's sidebar", () => {
  it('shows what waits, the unseen to stay aware of and the alerts in the fleet, each with its count', () => {
    const entries = entriesOf(sidebarOf());

    expect([entries.home?.text, entries['stay-aware']?.text, entries.done?.text, entries.fleet?.text]).toEqual(['Waiting on you4', 'Stay aware2', 'Done', 'Your fleet1']);
  });

  it("leads to each of Bridge's pages in the fleet in view", () => {
    const entries = entriesOf(sidebarOf());

    expect([entries.home?.href, entries['stay-aware']?.href, entries.done?.href, entries.fleet?.href]).toEqual(['/bridge?fleet=flt_01', '/bridge/stay-aware?fleet=flt_01', '/bridge/done?fleet=flt_01', '/bridge/fleet?fleet=flt_01']);
  });

  it('shows no count at nought, nor while it is not known', () => {
    const entries = entriesOf(sidebarOf({ counts: { waiting: 0, stayAware: undefined, basket: 0, fleetAlerts: undefined } }));

    expect([entries.home?.text, entries['stay-aware']?.text, entries.fleet?.text]).toEqual(['Waiting on you', 'Stay aware', 'Your fleet']);
  });

  it('shows the basket with its count while it holds any', () => {
    expect(entriesOf(sidebarOf({ counts: { ...COUNTS, basket: 3 } })).basket).toEqual({ href: '/bridge/basket?fleet=flt_01', text: 'Basket3', isCurrent: false });
  });

  it('leaves the basket out while it is empty', () => {
    expect(entriesOf(sidebarOf()).basket).toBeUndefined();
  });

  it('keeps the basket while it is the page in view, emptied', () => {
    expect(entriesOf(sidebarOf({ screen: 'basket' })).basket).toEqual({ href: '/bridge/basket?fleet=flt_01', text: 'Basket', isCurrent: true });
  });

  it('marks the page in view, and only it', () => {
    const entries = entriesOf(sidebarOf({ screen: 'done' }));

    expect(Object.entries(entries).filter(([, { isCurrent }]) => isCurrent).map(([key]) => key)).toEqual(['done']);
  });

  it('leads to the settings: Where things show, the outside parties, and the account page in the account app', () => {
    const entries = entriesOf(sidebarOf());

    expect([entries.settings, entries.routing, entries['outside-parties'], entries.account]).toEqual([
      { href: '/bridge/settings?fleet=flt_01', text: 'Settings', isCurrent: false },
      { href: '/bridge/settings/routing?fleet=flt_01', text: 'Where things show', isCurrent: false },
      { href: '/outside-parties?fleet=flt_01', text: 'Outside parties', isCurrent: false },
      { href: 'https://account.aeolus.test', text: 'Fleets and account', isCurrent: false },
    ]);
  });

  it('leaves Fleets and account out while the account app is not known', () => {
    expect(entriesOf(sidebarOf({ accountUrl: undefined })).account).toBeUndefined();
  });
});
