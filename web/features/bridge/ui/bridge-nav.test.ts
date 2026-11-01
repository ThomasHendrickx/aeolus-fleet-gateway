import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BridgeNav } from './bridge-nav';

// Bridge's navigation shows the basket with its count while it holds any
// (section 9, rule 2).

describe("Bridge's navigation", () => {
  it('shows the basket with its count while it holds any', () => {
    const markup = renderToStaticMarkup(createElement(BridgeNav, { fleetId: 'flt_01', current: 'home', basketCount: 3 }));

    expect({ basket: markup.includes('data-testid="bridge-nav-basket"'), count: markup.includes('Basket 3') }).toEqual({ basket: true, count: true });
  });

  it('leaves the basket out while it is empty', () => {
    const markup = renderToStaticMarkup(createElement(BridgeNav, { fleetId: 'flt_01', current: 'home', basketCount: 0 }));

    expect(markup.includes('data-testid="bridge-nav-basket"')).toBe(false);
  });
});
