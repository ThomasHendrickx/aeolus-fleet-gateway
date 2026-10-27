import { describe, expect, it } from 'vitest';

import { createSlackInstallSeals } from './slack-install-seals.js';
import { createWaitingSeals } from './waiting-seals.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const STATE = { fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv' as const, appId: 'A01', expiresAt: new Date('2026-10-27T09:10:00.000Z') };

describe("a Slack install's state, sealed into Slack's install address", () => {
  it('opens to the state it seals, safe in a URL', () => {
    const seals = createSlackInstallSeals(SECRET);
    const sealed = seals.seal(STATE);

    expect({ opened: seals.open(sealed), isUrlSafe: /^[A-Za-z0-9_-]+$/.test(sealed) }).toEqual({ opened: STATE, isUrlSafe: true });
  });

  it("opens none sealed under another gateway's secret, changed on the way, or sealed as another kind", () => {
    const seals = createSlackInstallSeals(SECRET);
    const sealed = seals.seal(STATE);
    const waiting = createWaitingSeals(SECRET).seal({ fleetId: STATE.fleetId, requestId: 'r', accountId: 'a', browserSecret: 'b', request: {} });

    expect([createSlackInstallSeals('another-gateway-secret-of-32-characters').open(sealed), seals.open(`${sealed.slice(0, -2)}xx`), seals.open(waiting)]).toEqual([undefined, undefined, undefined]);
  });
});
