import { describe, expect, it } from 'vitest';

import { openedScreenOf, screenOf } from './shell';

// Bridge's shell names the page in view: the breadcrumb on desktop, the
// screen title on the phone with a back chevron where one leads back, and
// the phone's tab shown current (docs/design/bridge/mockups).

describe("Bridge's screens", () => {
  it('names home Bridge, in the breadcrumb and as the phone title, with no way back and Waiting current', () => {
    expect(screenOf('home')).toEqual({ name: 'Bridge', hasBack: false, tab: 'waiting' });
  });

  it('names each other page as the sidebar does, the tab its page is under current', () => {
    expect((['stay-aware', 'done', 'fleet'] as const).map((screen) => screenOf(screen))).toEqual([
      { name: 'Stay aware', hasBack: false, tab: 'aware' },
      { name: 'Done', hasBack: false, tab: 'done' },
      { name: 'Your fleet', hasBack: false, tab: 'fleet' },
    ]);
  });

  it('leads back from the basket to home, under Waiting', () => {
    expect(screenOf('basket')).toEqual({ name: 'Basket', hasBack: true, tab: 'waiting' });
  });

  it('leads back from the settings, under no tab', () => {
    expect((['routing', 'settings'] as const).map((screen) => screenOf(screen))).toEqual([
      { name: 'Where things show', hasBack: true, tab: null },
      { name: 'Settings', hasBack: true, tab: null },
    ]);
  });
});

describe('the phone title of an opened item', () => {
  it('says Question for a question and Step for a step', () => {
    expect([openedScreenOf('decide'), openedScreenOf('do')]).toEqual(['Question', 'Step']);
  });

  it('says Stay aware for an alert or a notice, and Message for anything else', () => {
    expect([openedScreenOf('stay-aware'), openedScreenOf('everything-else')]).toEqual(['Stay aware', 'Message']);
  });
});
