import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BridgeHome } from '../services/items';
import { MessageRow } from './message-row';

// A plain message's row (#242, design/bridge-messages): Done in place says
// it is marking done while the fleet has not answered, and says so on the
// row when it did not, Done staying to try again.

const NOW = new Date('2026-10-31T20:00:00.000Z');

const MESSAGE: BridgeHome['messages'][number] = {
  deliveryId: 'dlv_11',
  from: 'builder-core',
  title: 'Staging is green again after the migration',
  sentAt: '2026-10-31T19:57:00.000Z',
  job: 'everything-else',
  isAlert: false,
  state: 'new',
  stale: null,
  inBasket: null,
  seenIn: null,
  places: [],
  actInPlace: null,
  excerpt: 'The 0.38 migration ran on staging at 19:52.',
};

function rowOf(props: Partial<Parameters<typeof MessageRow>[0]> = {}): string {
  return renderToStaticMarkup(createElement(MessageRow, { message: MESSAGE, now: NOW, isOpen: false, isMarkingDone: false, isOpening: false, isBusy: false, failure: undefined, onDone: () => undefined, onOpen: () => undefined, ...props }));
}

describe("a plain message's row (#242)", () => {
  it('says Message, its sender and its age, a dot while new, and its text beneath', () => {
    const markup = rowOf();

    expect({ word: markup.includes('>Message<'), from: markup.includes('builder-core'), dot: markup.includes('aria-label="New"'), text: markup.includes('The 0.38 migration ran on staging at 19:52.') }).toEqual({ word: true, from: true, dot: true, text: true });
  });

  it('shows Marking done... on Done, unpressable, while the fleet has not answered', () => {
    const markup = rowOf({ isMarkingDone: true, isBusy: true });

    expect(/<button[^>]*data-testid="bridge-message-done"[^>]*disabled[^>]*>.*Marking done\.\.\./.test(markup)).toBe(true);
  });

  it('says on the row when it was not marked done, Done staying to try again', () => {
    const markup = rowOf({ failure: 'Not marked done: the fleet did not answer. Try again.' });

    expect({ said: markup.includes('Not marked done: the fleet did not answer. Try again.'), done: markup.includes('>Done<') }).toEqual({ said: true, done: true });
  });

  it('shows no buttons beside an open item', () => {
    expect(rowOf({ onDone: undefined }).includes('bridge-message-done')).toBe(false);
  });
});
