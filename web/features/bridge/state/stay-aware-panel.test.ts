import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { HomeItem, RecordItem } from '../services/items';
import { StayAwarePanel } from './stay-aware-panel';

// Stay aware (stay-aware.html, CC16): the feed with its unseen count, the
// alerts and notices not seen yet marked new with Open, then the ones seen,
// done once seen, outside the count.

function anUnseen(overrides: Partial<HomeItem> = {}): HomeItem {
  return { deliveryId: 'dlv_01', from: 'watch', title: 'builder-gateway: no report change for 2 h', sentAt: '2026-10-31T19:47:00.000Z', job: 'stay-aware', state: 'new', stale: null, inBasket: null, ...overrides };
}

function aSeen(overrides: Partial<RecordItem> = {}): RecordItem {
  return { deliveryId: 'dlv_02', from: 'trierarch', title: 'trierarch plugin 0.35.1 released', sentAt: '2026-10-31T15:00:00.000Z', job: 'stay-aware', state: 'done', outcome: { place: 'bridge', kind: 'seen', option: null, at: '2026-10-31T15:05:00.000Z' }, ...overrides };
}

function render(feed: { unseen: HomeItem[]; record: RecordItem[] }): string {
  return renderToStaticMarkup(createElement(StayAwarePanel, { fleetId: 'flt_01', consoleUrl: 'https://fleet.aeolus-fleet.dev', ...feed }));
}

describe('Stay aware (stay-aware.html)', () => {
  it('says how many are not seen yet', () => {
    const markup = render({ unseen: [anUnseen()], record: [aSeen()] });

    expect(markup).toMatch(/data-testid="bridge-stay-aware-count"[^>]*>1 unseen</);
  });

  it('lists the ones seen after the unseen, with no dot and nothing to open', () => {
    const markup = render({ unseen: [anUnseen()], record: [aSeen()] });

    expect({
      rows: (markup.match(/data-testid="bridge-item"/g) ?? []).length,
      seen: markup.includes('trierarch plugin 0.35.1 released'),
      dots: (markup.match(/aria-label="New"/g) ?? []).length,
      opens: (markup.match(/data-testid="bridge-open"/g) ?? []).length,
    }).toEqual({ rows: 2, seen: true, dots: 1, opens: 1 });
  });

  it('leaves out what the record holds of the other jobs', () => {
    const markup = render({ unseen: [], record: [aSeen({ deliveryId: 'dlv_03', job: 'decide', title: 'Which goes first?' })] });

    expect(markup.includes('Which goes first?')).toBe(false);
  });

  it('says nothing new when nothing reached the person to stay aware of', () => {
    const markup = render({ unseen: [], record: [] });

    expect(markup).toContain('data-testid="bridge-nothing-new"');
  });
});
