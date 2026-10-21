import { describe, expect, it } from 'vitest';

import { forwardedCookieOf } from './gateway-api';

describe("the browser's cookies the web app's server forwards to the API", () => {
  it("forwards the shared sign-in alone, never the gateway's old page session nor argo's console session", () => {
    expect(forwardedCookieOf('aeolus_gateway_session=old-page; aeolus_session=argo; aeolus_account_session=charlotte; theme=dark')).toBe('aeolus_account_session=charlotte');
  });

  it('forwards nothing from a browser with no shared sign-in', () => {
    expect([forwardedCookieOf('aeolus_gateway_session=old-page; aeolus_session=argo'), forwardedCookieOf(undefined)]).toEqual([undefined, undefined]);
  });
});
