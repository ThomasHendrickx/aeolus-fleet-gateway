import { describe, expect, it } from 'vitest';

import { openedScreenOf, screenOf, shellCountsOf } from './shell';

// Bridge's shell names the page in view: the breadcrumb on desktop, the
// screen title on the phone with a back chevron where one leads back, and
// the phone's tab shown current (docs/design/bridge/mockups).

describe("Bridge's screens", () => {
  it('names home Bridge, in the breadcrumb and as the phone title, with no way back and Waiting current', () => {
    expect(screenOf('home')).toEqual({ name: 'Bridge', phoneTitle: 'Bridge', hasBack: false, tab: 'waiting' });
  });

  it('names each other page as the sidebar does, the Fleet tab as its tab on the phone, the tab its page is under current', () => {
    expect((['stay-aware', 'done', 'fleet'] as const).map((screen) => screenOf(screen))).toEqual([
      { name: 'Stay aware', phoneTitle: 'Stay aware', hasBack: false, tab: 'aware' },
      { name: 'Done', phoneTitle: 'Done', hasBack: false, tab: 'done' },
      { name: 'Your fleet', phoneTitle: 'Fleet', hasBack: false, tab: 'fleet' },
    ]);
  });

  it('leads back from the basket to home, under Waiting', () => {
    expect(screenOf('basket')).toEqual({ name: 'Basket', phoneTitle: 'Basket', hasBack: true, tab: 'waiting' });
  });

  it('leads back from the settings, under no tab', () => {
    expect((['routing', 'settings'] as const).map((screen) => screenOf(screen))).toEqual([
      { name: 'Where things show', phoneTitle: 'Where things show', hasBack: true, tab: null },
      { name: 'Settings', phoneTitle: 'Settings', hasBack: true, tab: null },
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

describe("the shell's counts", () => {
  const anItem = (state: 'new' | 'seen') => ({ state });

  it('counts what waits as home counts it, and only the unseen to stay aware of', () => {
    expect(shellCountsOf({ home: { kind: 'read', value: { waiting: { count: 3 }, stayAware: [anItem('new'), anItem('seen'), anItem('new')] } }, basket: 1, fleetAlerts: 2 })).toEqual({ waiting: 3, stayAware: 2, basket: 1, fleetAlerts: 2 });
  });

  it("keeps the argo count apart from what waits on the person: its own, for an account allowed as argo", () => {
    expect(shellCountsOf({ home: { kind: 'read', value: { waiting: { count: 2 }, stayAware: [] } }, basket: 0, fleetAlerts: undefined, argo: 4 })).toEqual({ waiting: 2, stayAware: 0, basket: 0, fleetAlerts: undefined, argo: 4 });
  });

  it('counts nothing waiting for an account with no person ship', () => {
    expect(shellCountsOf({ home: { kind: 'none' }, basket: 0, fleetAlerts: undefined })).toEqual({ waiting: 0, stayAware: 0, basket: 0, fleetAlerts: undefined });
  });

  it('leaves out what waits and the unseen while the record cannot be read', () => {
    expect(shellCountsOf({ home: { kind: 'unreadable' }, basket: 0, fleetAlerts: 1 })).toEqual({ waiting: undefined, stayAware: undefined, basket: 0, fleetAlerts: 1 });
  });
});
