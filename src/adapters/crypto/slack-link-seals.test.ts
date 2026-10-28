import { describe, expect, it } from 'vitest';

import { createSlackInstallSeals } from './slack-install-seals.js';
import { createSlackLinkSeals } from './slack-link-seals.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const STATE = { fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv' as const, accountId: 'acc-mathilde', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t' as const, expiresAt: new Date('2026-10-27T09:10:00.000Z') };

describe("a Slack link's state, sealed into Sign in with Slack's address", () => {
  it('opens to the state it seals, safe in a URL', () => {
    const seals = createSlackLinkSeals(SECRET);
    const sealed = seals.seal(STATE);

    expect({ opened: seals.open(sealed), isUrlSafe: /^[A-Za-z0-9_-]+$/.test(sealed) }).toEqual({ opened: STATE, isUrlSafe: true });
  });

  it("opens none sealed under another gateway's secret, changed on the way, or sealed as an install's state", () => {
    const seals = createSlackLinkSeals(SECRET);
    const sealed = seals.seal(STATE);
    const install = createSlackInstallSeals(SECRET).seal({ fleetId: STATE.fleetId, appId: 'A01', expiresAt: STATE.expiresAt });

    expect([createSlackLinkSeals('another-gateway-secret-of-32-characters').open(sealed), seals.open(`${sealed.slice(0, -2)}xx`), seals.open(install)]).toEqual([undefined, undefined, undefined]);
  });
});
