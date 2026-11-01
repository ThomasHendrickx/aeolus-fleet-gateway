import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

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
