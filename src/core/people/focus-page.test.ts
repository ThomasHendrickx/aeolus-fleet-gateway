import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryFocusedPages } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createFocusPage } from './focus-page.js';

// A person's page tells the gateway while it is in focus (wake a person, W6):
// it counts in focus from then, seen again every while, until it loses focus
// or its connection.

const SHIP = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const START = new Date('2026-10-23T10:00:00.000Z');
const SEEN_EVERY_MS = 20_000;

function focusing() {
  const focused = memoryFocusedPages();
  const clock = { at: START, now: () => clock.at };
  const stop = new AbortController();
  /** What was kept at each wait, as the page was seen again. */
  const seen: Date[][] = [];
  let waits = 0;
  const focusPage = createFocusPage({
    focused,
    clock,
    seenEveryMs: SEEN_EVERY_MS,
    sleep: (ms) => {
      seen.push(focused.held.map(({ seenAt }) => seenAt));
      waits += 1;
      clock.at = new Date(clock.at.getTime() + ms);
      if (waits === 3) {
        stop.abort();
      }
      return Promise.resolve();
    },
  });
  return { focused, seen, stop, focusPage };
}

describe('a page of a person in focus', () => {
  it('counts in focus at once, and is seen again every while it stays so', async () => {
    const { focusPage, seen, stop } = focusing();

    await focusPage({ ...SHIP, pageId: 'page-1' }, stop.signal);

    expect(seen).toEqual([[START], [new Date(START.getTime() + SEEN_EVERY_MS)], [new Date(START.getTime() + 2 * SEEN_EVERY_MS)]]);
  });

  it('is forgotten once it lost focus or its connection', async () => {
    const { focusPage, focused, stop } = focusing();

    await focusPage({ ...SHIP, pageId: 'page-1' }, stop.signal);

    expect(focused.held).toEqual([]);
  });
});
