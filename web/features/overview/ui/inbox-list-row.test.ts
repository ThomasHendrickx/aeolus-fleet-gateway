import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InboxList } from './inbox-list';

describe("a waiting message row on the Overview (aeolus-fleet#1238)", () => {
  it('keeps its controls within the phone page', () => {
    const markup = renderToStaticMarkup(
      createElement(InboxList, {
        waitingCount: 1,
        waiting: [{ deliveryId: 'dlv_01', from: 'helper', title: 'Hi Bea, the draft of the launch post is ready for your review: docs/launch-post-draft', sentAt: '2026-10-27T10:00:00.000Z' }],
        opened: [],
        openingId: undefined,
        failure: undefined,
        onOpen: () => undefined,
      }),
    );

    expect(markup).toContain('flex min-w-0 items-center gap-3');
  });
});
