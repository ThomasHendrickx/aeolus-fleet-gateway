import { describe, expect, it } from 'vitest';

import { createSignInSeals } from './sign-in-seals.js';
import { createWaitingSeals } from './waiting-seals.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const WAITING = {
  fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv' as const,
  requestId: 'req_01m5cdz6c8n6v8m2rsp0q7w2xa',
  accountId: 'acc-charlotte',
  browserSecret: 'the-secret-the-browser-holds-in-a-cookie',
  request: { client_id: 'https://orderbot.example.com/client.json', redirect_uri: 'https://orderbot.example.com/callback', state: 'state-1', scope: undefined },
};

describe("a browser's wait for an outside MCP client, sealed into the waiting page's address", () => {
  it('opens to the wait it seals', () => {
    const seals = createWaitingSeals(SECRET);

    expect(seals.open(seals.seal(WAITING))).toEqual({ ...WAITING, request: { client_id: WAITING.request.client_id, redirect_uri: WAITING.request.redirect_uri, state: 'state-1' } });
  });

  it("is safe in a URL and shows neither the browser's secret nor the client", () => {
    const sealed = createWaitingSeals(SECRET).seal(WAITING);

    expect({ isUrlSafe: /^[A-Za-z0-9_-]+$/.test(sealed), showsBrowserSecret: sealed.includes('cookie'), showsClient: sealed.includes('orderbot') }).toEqual({ isUrlSafe: true, showsBrowserSecret: false, showsClient: false });
  });

  it("opens none sealed under another gateway's secret, changed on the way, or sealed as a sign-in", () => {
    const seals = createWaitingSeals(SECRET);
    const sealed = seals.seal(WAITING);
    const signIn = createSignInSeals(SECRET).seal({ verifier: 'v', browserSecret: 'b', request: {}, holder: 'party', expiresAt: new Date('2026-10-19T09:10:00.000Z') });

    expect([createWaitingSeals('another-gateway-secret-of-32-characters!').seal(WAITING), `${sealed.slice(0, -2)}${sealed.endsWith('AA') ? 'BB' : 'AA'}`, signIn, 'not-a-seal'].map((each) => seals.open(each))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
