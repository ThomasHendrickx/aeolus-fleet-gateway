import { describe, expect, it } from 'vitest';

import { NOTHING_WATCHED, nextChangeAtOf, showingOf, watchedOf } from './leaving-stale';

// A withdrawn or replaced item leaves Bridge's overview 5 s after the
// withdrawal reached it (#240, design/bridge-withdrawn-leaves): struck
// through from 0 s, leaving in the last 300 ms, gone at 5 s; never shown when
// Bridge was not open at the withdrawal.

const STANDING = { deliveryId: 'dlv_01', isStale: false };
const WITHDRAWN = { deliveryId: 'dlv_01', isStale: true };
/** When the page first read the item standing, in ms. */
const READ_AT = 1_000_000;
/** When the withdrawal reached the open page. */
const STALE_AT = READ_AT + 60_000;

/** The page as it watched the item standing, then saw it stale at STALE_AT. */
function watchedStale() {
  return watchedOf(watchedOf(NOTHING_WATCHED, [STANDING], READ_AT), [WITHDRAWN], STALE_AT);
}

describe('a withdrawn item in an open Bridge (#240)', () => {
  it('shows an item that stands', () => {
    expect(showingOf(NOTHING_WATCHED, STANDING, READ_AT)).toBe('shown');
  });

  it('never shows an item already stale when the page first read it: Bridge was not open at the withdrawal', () => {
    expect(showingOf(NOTHING_WATCHED, WITHDRAWN, READ_AT)).toBe('gone');
  });

  it('shows an item the page read standing, struck through, the moment its withdrawal reaches the page', () => {
    const watched = watchedOf(NOTHING_WATCHED, [STANDING], READ_AT);

    expect(showingOf(watched, WITHDRAWN, STALE_AT)).toBe('shown');
  });

  it('still shows it 4.7 s less a moment after the withdrawal reached the page', () => {
    expect(showingOf(watchedStale(), WITHDRAWN, STALE_AT + 4699)).toBe('shown');
  });

  it('shows it leaving in the last 300 ms, from 4.7 s', () => {
    expect(showingOf(watchedStale(), WITHDRAWN, STALE_AT + 4700)).toBe('leaving');
  });

  it('has it gone at 5 s', () => {
    expect(showingOf(watchedStale(), WITHDRAWN, STALE_AT + 5000)).toBe('gone');
  });

  it('counts the 5 s from when the page first saw it stale, not from each read after', () => {
    const readAgain = watchedOf(watchedStale(), [WITHDRAWN], STALE_AT + 3000);

    expect(showingOf(readAgain, WITHDRAWN, STALE_AT + 5000)).toBe('gone');
  });

  it('wakes the page when the item starts leaving, then when it is gone, then no more', () => {
    const watched = watchedStale();

    expect([nextChangeAtOf(watched, STALE_AT), nextChangeAtOf(watched, STALE_AT + 4700), nextChangeAtOf(watched, STALE_AT + 5000)]).toEqual([STALE_AT + 4700, STALE_AT + 5000, undefined]);
  });
});
