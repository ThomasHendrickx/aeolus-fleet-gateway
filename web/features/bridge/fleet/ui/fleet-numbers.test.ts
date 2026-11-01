import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { YourFleet } from '../services/your-fleet';
import { FleetNumbers } from './fleet-numbers';

function fleetWith(counts: YourFleet['counts']): YourFleet {
  return { shipCount: 0, counts, groups: [] };
}

function numberTile(counts: YourFleet['counts'], state: string): string {
  const markup = renderToStaticMarkup(createElement(FleetNumbers, { fleet: fleetWith(counts), isShipCountShown: true }));
  return markup.match(new RegExp(`<div data-testid="fleet-number-${state}"[^>]*>`))?.[0] ?? '';
}

// The tone tokens switch with the theme (light and dark), so a tile that
// carries no tone class is plain in both.
describe('the numbers on Your fleet', () => {
  it('draws Alert plain at 0, so a zero does not draw the eye', () => {
    const tile = numberTile({ alert: 0, waiting: 0, working: 0, idle: 0 }, 'alert');

    expect(tile.includes('tone-attention')).toBe(false);
    expect(tile.includes('border-border bg-card')).toBe(true);
  });

  it('fills Alert in its tone from 1', () => {
    const tile = numberTile({ alert: 1, waiting: 0, working: 0, idle: 0 }, 'alert');

    expect(['border-tone-attention-border', 'bg-tone-attention-bg', 'text-tone-attention-fg'].map((c) => tile.includes(c))).toEqual([true, true, true]);
  });

  it.each(['waiting', 'working'] as const)('draws %s plain at 0 and in its colour from 1', (state) => {
    const zero = numberTile({ alert: 0, waiting: 0, working: 0, idle: 0 }, state);
    const one = numberTile({ alert: 0, waiting: 1, working: 1, idle: 0 }, state);

    expect([zero.includes('text-tone-'), one.includes('text-tone-')]).toEqual([false, true]);
  });
});
