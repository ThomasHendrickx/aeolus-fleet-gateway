import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InboxList } from './inbox-list';

describe("a person's inbox on the Overview (aeolus-fleet#1238)", () => {
  it('keeps a waiting message title from widening the phone page', () => {
    const markup = renderToStaticMarkup(
      createElement(InboxList, {
        waitingCount: 1,
        waiting: [{ deliveryId: 'delivery-1', from: 'writer', title: 'A title long enough to reach beyond a phone screen', sentAt: '2026-10-27T10:00:00.000Z' }],
        opened: [],
        openingId: undefined,
        failure: undefined,
        onOpen: () => undefined,
      }),
    );

    expect(markup).toContain('grid min-w-0 gap-2 rounded-md');
  });
});
