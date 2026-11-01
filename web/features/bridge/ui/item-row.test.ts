import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ItemRow } from './item-row';

// A grid or flex item will not shrink below its content unless min-w-0 lets it. Static markup has no layout,
// so this guards the classes; the width itself was measured at 390 px (aeolus-fleet#1238).
describe('an item row in Bridge (aeolus-fleet#1238)', () => {
  it('lets its card, row and title shrink to the phone page', () => {
    const markup = renderToStaticMarkup(
      createElement(ItemRow, {
        item: { deliveryId: 'dlv_01', from: 'helper', title: 'Hi Bea, the draft of the launch post is ready for your review: docs/launch-post-draft', sentAt: '2026-10-27T10:00:00.000Z', job: 'everything-else' },
        isNew: false,
        outcome: undefined,
        failure: undefined,
        children: null,
      }),
    );

    expect([markup.includes('grid min-w-0 gap-2 rounded-md'), markup.includes('flex min-w-0 items-center gap-3'), markup.includes('truncate')]).toEqual([true, true, true]);
  });
});
