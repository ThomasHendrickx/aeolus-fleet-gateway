import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BridgeScreen } from '../services/shell';
import type { ShellCounts } from './bridge-sidebar';
import { BridgeTabs } from './bridge-tabs';

// The phone's foot (home.html, basket.html; aeolus-fleet#1515): four tabs
// with their counts, and the basket as a bar above them while it holds any.

const COUNTS: ShellCounts = { waiting: 4, stayAware: 2, basket: 0, fleetAlerts: 1 };

function tabsOf({ screen = 'home', counts = COUNTS }: { screen?: BridgeScreen; counts?: ShellCounts } = {}): string {
  return renderToStaticMarkup(createElement(BridgeTabs, { fleetId: 'flt_01', screen, counts }));
}

function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, '');
}

/** Each tab by its key: where it leads, its words, whether it is the page in view. */
function phoneTabsOf(markup: string): { key: string; href: string | undefined; text: string; isCurrent: boolean }[] {
  return [...markup.matchAll(/<a([^>]*data-testid="bridge-tab-([^"]*)"[^>]*)>(.*?)<\/a>/g)].map(([, attributes = '', key = '', inner = '']) => ({
    key,
    href: /href="([^"]*)"/.exec(attributes)?.[1],
    text: textOf(inner),
    isCurrent: attributes.includes('aria-current="page"'),
  }));
}

function basketBarOf(markup: string): string | undefined {
  const start = markup.indexOf('data-testid="bridge-basket-bar"');
  return start === -1 ? undefined : markup.slice(start, markup.indexOf('</div>', start));
}

describe("the phone's tabs", () => {
  it('are Waiting, Aware, Done and Fleet, each with its count, leading to its page', () => {
    expect(phoneTabsOf(tabsOf())).toEqual([
      { key: 'waiting', href: '/bridge?fleet=flt_01', text: 'Waiting4', isCurrent: true },
      { key: 'aware', href: '/bridge/stay-aware?fleet=flt_01', text: 'Aware2', isCurrent: false },
      { key: 'done', href: '/bridge/done?fleet=flt_01', text: 'Done', isCurrent: false },
      { key: 'fleet', href: '/bridge/fleet?fleet=flt_01', text: 'Fleet1', isCurrent: false },
    ]);
  });

  it('show the tab the page in view is under current, Waiting for the basket', () => {
    expect(phoneTabsOf(tabsOf({ screen: 'basket' })).filter(({ isCurrent }) => isCurrent).map(({ key }) => key)).toEqual(['waiting']);
  });

  it('show no tab current on a page of the settings', () => {
    expect(phoneTabsOf(tabsOf({ screen: 'routing' })).filter(({ isCurrent }) => isCurrent)).toEqual([]);
  });
});

describe("the phone's basket bar", () => {
  it('shows above the tabs while the basket holds any, with its count, and opens the basket', () => {
    const bar = basketBarOf(tabsOf({ counts: { ...COUNTS, basket: 1 } }));

    expect({ text: textOf(`<${bar ?? ''}`), opens: bar?.includes('href="/bridge/basket?fleet=flt_01"') }).toEqual({ text: 'Basket 1 not sentOpen', opens: true });
  });

  it('is left out while the basket is empty', () => {
    expect(basketBarOf(tabsOf())).toBeUndefined();
  });

  it('is left out on the basket itself', () => {
    expect(basketBarOf(tabsOf({ screen: 'basket', counts: { ...COUNTS, basket: 1 } }))).toBeUndefined();
  });
});
