import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryFocusedPages, memoryRoutes } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { ok } from '../shared/result.js';
import { createPersonWakes, type WakeItem } from './person-wakes.js';
import type { PersonShip, WakeChannel, WakeChannelName } from './ports.js';
import { routingDefaultsOf, type Route } from './routing.js';

// People's published port for waking a person for what waits beyond their
// own person ship: the person's own rules (wake a person, W6, W8; Bridge,
// section 8) without their model or stores.

const SHIP: PersonShip = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const NOW = new Date('2026-11-01T20:12:00.000Z');
const WINDOW_MS = 600_000;
const FOCUS_FRESH_MS = 60_000;
const TRIERARCH_SHIP_ID = 'shp_01m3tbfspe96yf1rnr4ank9trr';

function aChannel(name: WakeChannelName, options: { isOn?: boolean } = {}): WakeChannel {
  return { name, windowMs: WINDOW_MS, isOn: () => Promise.resolve(options.isOn ?? true), wake: () => Promise.resolve(ok(undefined)) };
}

function anItem(key: string, contentType: string): WakeItem {
  return { key, contentType, sentAt: NOW, senderShipId: TRIERARCH_SHIP_ID };
}

function aRoute(overrides: Partial<Route>): Route {
  return { ...SHIP, job: 'everything-else', place: 'web-push', isOn: true, changedAt: new Date('2026-10-30T00:00:00.000Z'), ...overrides };
}

describe("People's published port for a wake", () => {
  it('shows each item only on the channels on now whose route is on for its job', async () => {
    const focused = memoryFocusedPages();
    const people = createPersonWakes({
      channels: [aChannel('web-push'), aChannel('email', { isOn: false })],
      routes: memoryRoutes([aRoute({ job: 'everything-else', place: 'web-push' }), aRoute({ job: 'everything-else', place: 'email' })]),
      defaults: routingDefaultsOf([]),
      focused,
      focusFreshMs: FOCUS_FRESH_MS,
      clock: { now: () => NOW },
    });

    await expect(people.showing(SHIP, [anItem('report', 'text/plain'), anItem('question', 'application/vnd.aeolus.question+json')])).resolves.toEqual([{ name: 'web-push', windowMs: WINDOW_MS, keys: ['report'] }]);
  });

  it('finds a page of the person in focus only while it was seen so lately', async () => {
    const focused = memoryFocusedPages();
    const people = createPersonWakes({ channels: [], routes: memoryRoutes(), defaults: routingDefaultsOf([]), focused, focusFreshMs: FOCUS_FRESH_MS, clock: { now: () => NOW } });
    await focused.save({ ...SHIP, pageId: 'page-1', seenAt: new Date(NOW.getTime() - 2 * FOCUS_FRESH_MS) });
    const isInFocusWhenStale = await people.isInFocus(SHIP);

    await focused.save({ ...SHIP, pageId: 'page-1', seenAt: NOW });

    expect({ isInFocusWhenStale, isInFocusNow: await people.isInFocus(SHIP) }).toEqual({ isInFocusWhenStale: false, isInFocusNow: true });
  });
});
