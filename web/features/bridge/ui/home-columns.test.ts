import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HomeColumns } from './home-columns';

describe("Bridge home's columns (design/bridge-fleet-width)", () => {
  it('keeps what waits at its reading width, at most 44rem, and gives Your fleet the rest, at least 20rem', () => {
    const markup = renderToStaticMarkup(createElement(HomeColumns, { main: 'waits', aside: 'fleet' }));

    expect(markup.includes('lg:grid-cols-[minmax(0,44rem)_minmax(20rem,1fr)]')).toBe(true);
  });
});
