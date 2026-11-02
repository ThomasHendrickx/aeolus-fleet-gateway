import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ItemSplit } from './item-split';

const LIST = createElement('ul', { id: 'the-list' });
const ITEM = createElement('section', { id: 'the-item' });

// Desktop: the list beside the open item; phone: the item on its own screen (decide.html, aeolus-fleet#1538).
describe('the split of a list and its open item (aeolus-fleet#1538)', () => {
  it('shows the list alone while no item is open', () => {
    const markup = renderToStaticMarkup(createElement(ItemSplit, { list: LIST, item: undefined }));

    expect({ list: markup.includes('id="the-list"'), split: markup.includes('data-testid="bridge-split"'), hidden: markup.includes('hidden') }).toEqual({ list: true, split: false, hidden: false });
  });

  it('puts the list beside the open item on a desktop, and the item alone on a phone', () => {
    const markup = renderToStaticMarkup(createElement(ItemSplit, { list: LIST, item: ITEM }));
    const split = (/<div data-testid="bridge-split" class="([^"]*)"/.exec(markup)?.[1] ?? '').split(' ');
    const list = (/<div data-testid="bridge-split-list" class="([^"]*)"/.exec(markup)?.[1] ?? '').split(' ');

    expect({
      beside: split.includes('md:grid-cols-[340px_minmax(0,1fr)]'),
      listOnPhone: list.includes('hidden') && list.includes('md:block'),
      order: markup.indexOf('id="the-list"') < markup.indexOf('id="the-item"'),
    }).toEqual({ beside: true, listOnPhone: true, order: true });
  });

  it('fills the area under the top bar edge to edge on a desktop, two panes and a divider, no inset card (decide.html, do.html)', () => {
    const markup = renderToStaticMarkup(createElement(ItemSplit, { list: LIST, item: ITEM }));
    const split = (/<div data-testid="bridge-split" class="([^"]*)"/.exec(markup)?.[1] ?? '').split(' ');
    const list = (/<div data-testid="bridge-split-list" class="([^"]*)"/.exec(markup)?.[1] ?? '').split(' ');

    expect({
      edgeToEdge: ['md:-mx-6', 'md:-my-5', 'md:min-h-[calc(100dvh-3.5rem)]'].every((name) => split.includes(name)),
      card: split.some((name) => name.startsWith('md:rounded') || name === 'md:border' || name === 'md:bg-card'),
      divider: list.includes('border-r'),
    }).toEqual({ edgeToEdge: true, card: false, divider: true });
  });
});
