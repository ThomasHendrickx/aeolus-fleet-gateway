import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AlertShip } from './alert-ship';

// An opened alert (stay-aware.html): the ship's tile as the alert left it,
// Open <ship>'s Health in the console, and the info line on what clears it.

const ALERT = { ship: { id: 'shp_01m6bw3rg8n3xmqe91x19xm3y7', name: 'builder-gateway' }, signal: 'report-unchanged' as const };
const HEALTH = 'https://fleet.aeolus-fleet.dev/ships/shp_01m6bw3rg8n3xmqe91x19xm3y7';

describe("an opened alert's ship", () => {
  it("shows the ship's tile in the alert's tone, as the alert left it", () => {
    const markup = renderToStaticMarkup(createElement(AlertShip, { alert: ALERT, healthHref: HEALTH }));

    expect(/data-testid="bridge-alert-tile"[^>]*>.*builder-gateway.*Alert/s.test(markup)).toBe(true);
  });

  it("links the ship's Health in the console, in a tab of its own", () => {
    const markup = renderToStaticMarkup(createElement(AlertShip, { alert: ALERT, healthHref: HEALTH }));

    expect(markup).toMatch(new RegExp(`<a[^>]*href="${HEALTH}"[^>]*target="_blank"[^>]*>.*Open builder-gateway’s Health</a>`, 's'));
  });

  it("leaves out Health when the fleet's console is not known", () => {
    const markup = renderToStaticMarkup(createElement(AlertShip, { alert: ALERT, healthHref: undefined }));

    expect(markup.includes('Health')).toBe(false);
  });

  it('says Aeolus only tells, and nothing is sent when the alert clears', () => {
    const markup = renderToStaticMarkup(createElement(AlertShip, { alert: ALERT, healthHref: HEALTH }));

    expect(markup).toContain('Aeolus only tells you. The alert clears when builder-gateway reports again; nothing is sent on clear, so this stays here as it was.');
  });
});
