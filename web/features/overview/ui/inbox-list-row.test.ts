import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { InboxEntry } from '../services/deliveries';
import { InboxList } from './inbox-list';

const entry: InboxEntry = { deliveryId: 'dlv_01', from: 'helper', title: 'Hi Bea, the draft of the launch post is ready for your review: docs/launch-post-draft', sentAt: '2026-10-27T10:00:00.000Z' };

function render(group: 'waiting' | 'opened'): string {
  return renderToStaticMarkup(
    createElement(InboxList, {
      waitingCount: 1,
      waiting: group === 'waiting' ? [entry] : [],
      opened: group === 'opened' ? [entry] : [],
      openingId: undefined,
      failure: undefined,
      onOpen: () => undefined,
    }),
  );
}

// A grid or flex item will not shrink below its content unless min-w-0 lets it. static markup has no layout,
// so this guards the classes; the width itself was measured at 390 px (aeolus-fleet#1238).
describe('a message row on the Overview (aeolus-fleet#1238)', () => {
  it.each(['waiting', 'opened'] as const)('lets its %s card and row shrink to the phone page', (group) => {
    const markup = render(group);

    expect(markup).toContain('grid min-w-0 gap-2 rounded-md');
    expect(markup).toContain('flex min-w-0 items-center gap-3');
  });
});
