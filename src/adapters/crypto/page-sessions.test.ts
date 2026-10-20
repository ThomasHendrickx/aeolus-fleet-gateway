import { describe, expect, it } from 'vitest';

import { createPageSessions } from './page-sessions.js';
import { createWaitingSeals } from './waiting-seals.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const SESSION = { fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv' as const, grantId: 'the-grant-id-the-gateway-drew' };

describe("a page session, sealed into the gateway's own cookie", () => {
  it('is found in a Cookie header beside other cookies', () => {
    const sessions = createPageSessions(SECRET);

    expect(sessions.inCookie(`aeolus_session=console; aeolus_gateway_session=${sessions.seal(SESSION)}; theme=dark`)).toEqual(SESSION);
  });

  it('is safe in a cookie and does not show its grant', () => {
    const sealed = createPageSessions(SECRET).seal(SESSION);

    expect({ isCookieSafe: /^[A-Za-z0-9_-]+$/.test(sealed), showsGrant: sealed.includes('grant') }).toEqual({ isCookieSafe: true, showsGrant: false });
  });

  it("finds none in a header without it, sealed under another gateway's secret, or sealed as a wait", () => {
    const sessions = createPageSessions(SECRET);
    const waiting = createWaitingSeals(SECRET).seal({ fleetId: SESSION.fleetId, requestId: 'req_1', accountId: 'acc-charlotte', browserSecret: 'b', request: {} });

    expect(['aeolus_session=console', `aeolus_gateway_session=${createPageSessions('another-gateway-secret-of-32-characters!').seal(SESSION)}`, `aeolus_gateway_session=${waiting}`, 'aeolus_gateway_session='].map((cookie) => sessions.inCookie(cookie))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
