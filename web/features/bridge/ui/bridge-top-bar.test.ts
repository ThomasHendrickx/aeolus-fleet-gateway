import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { headerSwitchersOf } from '../../frame/services/header-switchers';
import type { BridgeScreen } from '../services/shell';
import { BridgeTopBar } from './bridge-top-bar';

// Bridge's top bar (home.html, basket.html, decide.html): on desktop the
// breadcrumb and Live; on the phone the screen title, with a back chevron
// where it leads back, Live and the avatar.

function topBarOf({ screen = 'home', fleetName = 'Aeolus fleet', isLive = true, opened }: { screen?: BridgeScreen; fleetName?: string | null; isLive?: boolean; opened?: { title: string; onBack: () => void } } = {}): string {
  return renderToStaticMarkup(createElement(BridgeTopBar, { fleetId: 'flt_01', fleetName: fleetName ?? undefined, screen, isLive, opened, avatar: null }));
}

function textOf(markup: string, testId: string): string | undefined {
  const match = new RegExp(`<[^>]*data-testid="${testId}"[^>]*>(.*?)</(span|a|button|h1)>`).exec(markup);
  return match?.[1]?.replace(/<[^>]*>/g, '');
}

describe("Bridge's top bar", () => {
  it('shows the fleet and the page in view in the breadcrumb', () => {
    expect(textOf(topBarOf({ screen: 'done' }), 'bridge-crumb')).toBe('Aeolus fleet / Done');
  });

  it('shows the page alone in the breadcrumb while the fleet is not known', () => {
    expect(textOf(topBarOf({ screen: 'done', fleetName: null }), 'bridge-crumb')).toBe('Done');
  });

  it('says Live while the page follows its changes', () => {
    expect(textOf(topBarOf(), 'bridge-live')).toBe('Live');
  });

  it('says nothing of Live while it does not', () => {
    expect(topBarOf({ isLive: false }).includes('data-testid="bridge-live"')).toBe(false);
  });

  it("names the page in view as the phone's title", () => {
    expect(textOf(topBarOf(), 'bridge-title')).toBe('Bridge');
  });

  it('leads back to home from the basket and the settings with a back chevron', () => {
    const backs = (['basket', 'routing', 'settings'] as const).map((screen) => /<a[^>]*data-testid="bridge-back"[^>]*href="([^"]*)"/.exec(topBarOf({ screen }))?.[1]);

    expect(backs).toEqual(['/bridge?fleet=flt_01', '/bridge?fleet=flt_01', '/bridge?fleet=flt_01']);
  });

  it('shows no back chevron on a page under a tab', () => {
    expect((['home', 'stay-aware', 'done', 'fleet'] as const).map((screen) => topBarOf({ screen }).includes('data-testid="bridge-back"'))).toEqual([false, false, false, false]);
  });

  it('names an opened item as the title, with a back chevron that closes it', () => {
    const markup = topBarOf({ opened: { title: 'Question', onBack: () => undefined } });

    expect({ title: textOf(markup, 'bridge-title'), back: /<button[^>]*data-testid="bridge-back"/.test(markup) }).toEqual({ title: 'Question', back: true });
  });

  it('names Waiting on you in the breadcrumb while an item is open from home', () => {
    expect(textOf(topBarOf({ opened: { title: 'Question', onBack: () => undefined } }), 'bridge-crumb')).toBe('Aeolus fleet / Waiting on you');
  });

  it("keeps the page's name in the breadcrumb while an item is open from another page", () => {
    expect(textOf(topBarOf({ screen: 'stay-aware', opened: { title: 'Stay aware', onBack: () => undefined } }), 'bridge-crumb')).toBe('Aeolus fleet / Stay aware');
  });
});


const FLEET = 'flt_01m5fcd917vwf30mx663fgc3z8';

describe("Bridge's app switcher", () => {
  const [switcher] = headerSwitchersOf({
    account: { id: 'acc-thomas', email: 'thomas@example.com' },
    apps: [{ app: 'account', url: 'https://account.example/' }, { app: 'admin', url: 'https://account.example/admin' }],
    fleets: [{ id: FLEET, name: 'Aeolus fleet', apps: [{ app: 'console', url: 'https://console.example/' }, { app: 'gateway', url: 'https://bridge.example/' }] }],
  });

  it('offers the shared desktop and phone switchers where the product name was', () => {
    const markup = renderToStaticMarkup(createElement(BridgeTopBar, { fleetId: FLEET, fleetName: 'Aeolus fleet', screen: 'home', isLive: true, opened: undefined, avatar: null, switcher }));

    expect(markup).toContain('data-testid="app-switcher-apps"');
    expect(markup).toContain('Switch fleet or app: Aeolus fleet, Gateway');
    expect(markup).not.toContain('data-testid="bridge-crumb"');
    expect(markup).not.toContain('data-testid="bridge-title"');
  });

  it('offers Console, Gateway, Account and Admin with the rights the account has', () => {
    expect(switcher?.apps.map(({ label, url, isCurrent }) => ({ label, url, isCurrent }))).toEqual([
      { label: 'Console', url: `https://console.example/?fleet=${FLEET}`, isCurrent: false },
      { label: 'Gateway', url: `https://bridge.example/?fleet=${FLEET}`, isCurrent: true },
      { label: 'Account', url: 'https://account.example/', isCurrent: false },
      { label: 'Admin', url: 'https://account.example/admin', isCurrent: false },
    ]);
  });
});
