import { describe, expect, it } from 'vitest';

import { apiHeadersOf, forwardedCookieOf } from './gateway-api';

describe("the browser's cookies the web app's server forwards to the API", () => {
  it("forwards the shared sign-in alone, never the gateway's old page session nor argo's console session", () => {
    expect(forwardedCookieOf('aeolus_gateway_session=old-page; aeolus_session=argo; aeolus_account_session=charlotte; theme=dark')).toBe('aeolus_account_session=charlotte');
  });

  it('forwards nothing from a browser with no shared sign-in', () => {
    expect([forwardedCookieOf('aeolus_gateway_session=old-page; aeolus_session=argo'), forwardedCookieOf(undefined)]).toEqual([undefined, undefined]);
  });
});

describe("the headers the web app's server sends the API", () => {
  it("sends the waiting page's browser secret in its own header, never in the call's address", () => {
    expect(apiHeadersOf({ cookie: 'aeolus_account_session=charlotte; aeolus_waiting=w-secret', fleetId: undefined, waitingSecret: 'w-secret' })).toEqual({ cookie: 'aeolus_account_session=charlotte', 'aeolus-waiting-secret': 'w-secret' });
  });

  it('sends no waiting secret for any other page', () => {
    expect(apiHeadersOf({ cookie: undefined, fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv' })).toEqual({ 'aeolus-fleet': 'flt_01m3tb1zgr5h2ffee12xnch8sv' });
  });
});
