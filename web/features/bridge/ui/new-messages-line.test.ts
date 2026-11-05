import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NewMessagesLine } from './new-messages-line';

// The line on top of a phone's Waiting tab (#242, design/bridge-messages):
// with more messages than home lists, it leads to the new ones, above
// Waiting on you.

describe("the phone's new messages line", () => {
  it('says how many new messages wait, leading to the Messages page, on a phone only', () => {
    const markup = renderToStaticMarkup(createElement(NewMessagesLine, { href: '/bridge/messages?fleet=flt_01', newCount: 8 }));

    expect(/<a[^>]*data-testid="bridge-new-messages"[^>]*href="\/bridge\/messages\?fleet=flt_01"[^>]*class="[^"]*sm:hidden[^"]*".*8 new messages.*Show/.test(markup)).toBe(true);
  });
});
