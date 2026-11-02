import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HomeColumns } from './home-columns';

// states.html: the record's banner runs the whole width under the title, and
// Your fleet starts below it, beside what home shows.
describe("Bridge home's columns", () => {
  it('puts a banner across the whole width, above home and Your fleet', () => {
    const markup = renderToStaticMarkup(createElement(HomeColumns, { banner: createElement('p', null, 'banner'), main: createElement('p', null, 'home'), aside: createElement('p', null, 'fleet') }));

    expect(markup.indexOf('<p>banner</p>') < markup.indexOf('lg:grid-cols-') && markup.indexOf('lg:grid-cols-') < markup.indexOf('<p>fleet</p>')).toBe(true);
  });
});

describe("Bridge home's title row (home.html, states.html)", () => {
  it('runs the whole width above the banner, home and Your fleet', () => {
    const markup = renderToStaticMarkup(createElement(HomeColumns, { heading: createElement('p', null, 'heading'), banner: createElement('p', null, 'banner'), main: createElement('p', null, 'home'), aside: createElement('p', null, 'fleet') }));

    expect(markup.includes('<p>heading</p>') && markup.indexOf('<p>heading</p>') < markup.indexOf('<p>banner</p>')).toBe(true);
  });
});

// decide.html, do.html: an opened item takes Your fleet's place, the list beside it (aeolus-fleet#1538).
describe("Bridge home's columns while an item is open", () => {
  it('gives the whole width to the list and the open item, Your fleet out of sight', () => {
    const markup = renderToStaticMarkup(createElement(HomeColumns, { main: createElement('p', null, 'home'), aside: createElement('p', null, 'fleet') }));
    const columns = (/<div class="([^"]*lg:grid-cols-[^"]*)"/.exec(markup)?.[1] ?? '').replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' ');

    expect({ whole: columns.includes('has-[[data-testid=bridge-split]]:lg:grid-cols-1'), fleetHidden: markup.includes('in-[:has([data-testid=bridge-split])]:hidden') || columns.includes('has-[[data-testid=bridge-split]]:[&>:last-child]:hidden') }).toEqual({ whole: true, fleetHidden: true });
  });
});
