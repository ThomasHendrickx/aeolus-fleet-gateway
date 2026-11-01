import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FadedAsLastRead } from './faded-as-last-read';
import { AsLastRead } from './kept-read';

// Done and the basket while the record cannot be read: their lists as last
// read, faded and not to be acted on, saying so under them.

function render(at: string | undefined): string {
  return renderToStaticMarkup(createElement(AsLastRead, { at, children: createElement(FadedAsLastRead, { children: createElement('ul', null, 'the list') }) }));
}

describe('a page as last read', () => {
  it('shows the list as read now, untouched, while it is', () => {
    expect(render(undefined)).toBe('<ul>the list</ul>');
  });

  it('shows the list faded and not to be acted on, as last read, saying when', () => {
    const markup = render('2026-10-31T20:14:00.000Z');

    expect({ faded: markup.includes('<div inert="" class="opacity-60"><ul>the list</ul></div>'), shown: markup.includes('Shown as last read, at 20:14 UTC.') }).toEqual({ faded: true, shown: true });
  });
});

describe('acting on a page as last read', () => {
  it('leaves out its buttons, such as Open, since acting goes through the fleet', () => {
    const markup = renderToStaticMarkup(createElement(AsLastRead, { at: '2026-10-31T20:14:00.000Z', children: createElement(FadedAsLastRead, { children: createElement('button', null, 'Open') }) }));

    expect(markup.includes('[&amp;_button]:hidden')).toBe(true);
  });
});
