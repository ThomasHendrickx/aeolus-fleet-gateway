import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ItemRow } from './item-row';

// A grid or flex item will not shrink below its content unless min-w-0 lets it. Static markup has no layout,
// so this guards the classes; the width itself was measured at 390 px (aeolus-fleet#1238). A phone wraps the
// title and a desktop cuts it, as the mockups draw it (aeolus-fleet#1535).
describe('an item row in Bridge (aeolus-fleet#1238)', () => {
  it('lets its card, row and title shrink to the phone page', () => {
    const markup = renderToStaticMarkup(
      createElement(ItemRow, {
        item: { deliveryId: 'dlv_01', from: 'helper', title: 'Hi Bea, the draft of the launch post is ready for your review: docs/launch-post-draft', sentAt: '2026-10-27T10:00:00.000Z', job: 'everything-else' },
        now: new Date('2026-10-27T10:05:00.000Z'),
        isNew: false,
        outcome: undefined,
        failure: undefined,
      }),
    );

    expect([markup.includes('grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto]'), markup.includes('flex min-w-0 flex-col'), markup.includes('min-w-0 break-words') && markup.includes('sm:truncate')]).toEqual([true, true, true]);
  });
});

describe('the open item’s row, in the list beside it (decide.html, aeolus-fleet#1538)', () => {
  function render(isOpen: boolean): string {
    return renderToStaticMarkup(
      createElement(ItemRow, {
        item: { deliveryId: 'dlv_01', from: 'orchestrator-1', title: 'Which goes first?', sentAt: '2026-10-31T19:41:00.000Z', job: 'decide' },
        now: new Date('2026-10-31T19:53:00.000Z'),
        isNew: false,
        isOpen,
        outcome: 'Seen',
        failure: undefined,
      }),
    );
  }

  it('marks the open item, on the active tone with a bar at its side, as the current one', () => {
    const row = /<li[^>]*>/.exec(render(true))?.[0] ?? '';

    expect({ current: row.includes('aria-current="true"'), ground: row.includes('bg-tone-active-bg'), bar: row.includes('border-l-tone-active-fg') }).toEqual({ current: true, ground: true, bar: true });
  });

  it('marks no other row', () => {
    const row = /<li[^>]*>/.exec(render(false))?.[0] ?? '';

    expect({ current: row.includes('aria-current'), ground: row.includes('bg-tone-active-bg') }).toEqual({ current: false, ground: false });
  });
});
