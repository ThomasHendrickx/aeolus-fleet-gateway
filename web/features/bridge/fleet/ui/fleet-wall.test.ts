import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { YourFleet } from '../services/your-fleet';
import { FleetWall } from './fleet-wall';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const CONSOLE_URL = 'https://console.aeolus-fleet.dev';

/** Ships as the approved mockup draws them (design/bridge-fleet-width): one per kind, each state once. */
const GROUPS: YourFleet['groups'] = [
  { group: 'people', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9arg', name: 'argo', state: 'idle', note: null, lastActivityAt: null }] },
  { group: 'agents', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9orc', name: 'orchestrator-1', state: 'working', note: 'Cutting #189 into slices', lastActivityAt: '2026-11-02T11:59:30.000Z' }] },
  { group: 'plugins', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9tri', name: 'trierarch-plugin', state: 'waiting', note: 'Watching 12 sessions', lastActivityAt: '2026-11-02T11:35:00.000Z' }] },
  { group: 'throughTheGateway', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9mem', name: 'company-memory', state: 'alert', note: 'Last call: search', lastActivityAt: '2026-10-20T09:00:00.000Z' }] },
];

function wall(consoleUrl: string | undefined): string {
  return renderToStaticMarkup(createElement(FleetWall, { groups: GROUPS, consoleUrl, tileColumns: 'grid-cols-2', now: NOW }));
}

describe("Your fleet's groups on the phone's Fleet tab", () => {
  it('heads each group at the touch size, 15 px, as the phone draws it', () => {
    expect(/<h3 class="[^"]*max-sm:text-body-touch/.test(wall(CONSOLE_URL))).toBe(true);
  });
});

describe('a ship tile on Your fleet', () => {
  it("opens the ship's page in the fleet's console (aeolus-fleet#1475, option 1 on #194)", () => {
    expect(wall(CONSOLE_URL).includes(`href="${CONSOLE_URL}/ships/shp_01m3tbfspe96yf1rnr4ank9orc"`)).toBe(true);
  });

  it('opens nothing while the console is not known, so it is no link', () => {
    expect([wall(undefined).includes('<a '), wall(undefined).includes('data-testid="fleet-tile"')]).toEqual([false, true]);
  });

  it('shows the whole name and what the ship is doing', () => {
    const markup = wall(CONSOLE_URL);

    expect([markup.includes('truncate'), markup.includes('>orchestrator-1<'), markup.includes('>Cutting #189 into slices<')]).toEqual([false, true, true]);
  });

  it("says on hover the ship's state while it has no report yet", () => {
    expect(wall(CONSOLE_URL).includes('title="argo: Idle"')).toBe(true);
  });

  it("marks the ship's kind at its top left, as its group heading does", () => {
    const markup = wall(CONSOLE_URL);

    expect(['Person', 'Agent', 'Plugin', 'Through the gateway'].map((kind) => markup.includes(`data-testid="fleet-tile-kind" title="${kind}"`))).toEqual([true, true, true, true]);
  });

  it('runs the live band on a working ship alone', () => {
    expect((wall(CONSOLE_URL).match(/data-testid="fleet-tile-live"/g) ?? []).length).toBe(1);
  });

  it('stands the live band still under reduced motion, a solid line with no running light', () => {
    expect(wall(CONSOLE_URL).includes('motion-reduce:animate-none motion-reduce:bg-none')).toBe(true);
  });

  it('shows the arrow on hover and on keyboard focus', () => {
    const markup = wall(CONSOLE_URL);

    expect([markup.includes('group-hover:opacity-100'), markup.includes('group-focus-visible:opacity-100'), markup.includes('focus-visible:outline-2')]).toEqual([true, true, true]);
  });
});

describe("a ship tile's last activity", () => {
  it('says when each ship last did something, at the foot beside its state', () => {
    const ages = [...wall(CONSOLE_URL).matchAll(/data-testid="fleet-tile-age"[^>]*>([^<]*)</g)].map(([, age]) => age);

    expect(ages).toEqual(['No activity yet', 'now', '25 min', '20 Oct']);
  });

  it('says No activity yet, muted, in the time\'s place for a ship that did nothing yet', () => {
    const argo = wall(CONSOLE_URL).split('data-testid="fleet-tile"').find((tile) => tile.includes('>argo<'));

    expect(argo?.match(/data-testid="fleet-tile-age" class="([^"]*)">No activity yet</)?.[1]).toBe('text-caption text-muted-foreground');
  });
});
