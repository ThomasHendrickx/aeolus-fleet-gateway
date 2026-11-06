import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { HomeItem } from '../services/items';
import { StayAwarePanel } from './stay-aware-panel';

// Stay aware (stay-aware.html, CC16): the feed with its unseen count, the
// alerts and notices not seen yet marked new, the seen ones after them,
// outside the count.

function anItem(overrides: Partial<HomeItem> = {}): HomeItem {
  return { deliveryId: 'dlv_01', from: 'watch', fromShipId: 'shp_01', title: 'builder-gateway: no report change for 2 h', sentAt: '2026-10-31T19:47:00.000Z', job: 'stay-aware', isAlert: true, state: 'new', stale: null, inBasket: null, seenIn: null, places: [], actInPlace: null, ...overrides };
}

const SEEN = anItem({ deliveryId: 'dlv_02', from: 'trierarch', title: 'trierarch plugin 0.35.1 released', sentAt: '2026-10-31T15:00:00.000Z', isAlert: false, state: 'done', seenIn: 'bridge' });

function render(stayAware: HomeItem[]): string {
  return renderToStaticMarkup(createElement(StayAwarePanel, { fleetId: 'flt_01', consoleUrl: 'https://fleet.aeolus-fleet.dev', stayAware, now: '2026-10-31T19:53:00.000Z' }));
}

describe('Stay aware (stay-aware.html)', () => {
  it('says how many are not seen yet', () => {
    const markup = render([anItem(), SEEN]);

    expect(markup).toMatch(/data-testid="bridge-stay-aware-count"[^>]*>1 unseen</);
  });

  it('lists the ones seen beside the unseen, a dot only on the unseen', () => {
    const markup = render([anItem(), SEEN]);

    expect({
      rows: (markup.match(/data-testid="bridge-item"/g) ?? []).length,
      seen: markup.includes('trierarch plugin 0.35.1 released'),
      dots: (markup.match(/aria-label="New"/g) ?? []).length,
    }).toEqual({ rows: 2, seen: true, dots: 1 });
  });

  it('says nothing new when nothing reached the person to stay aware of', () => {
    const markup = render([]);

    expect(markup).toContain('data-testid="bridge-nothing-new"');
  });
});
