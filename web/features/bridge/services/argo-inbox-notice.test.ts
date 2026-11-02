import { describe, expect, it } from 'vitest';

import { ARGO_READ_RULE_GUIDE_URL, argoInboxNoticeOf } from './argo-inbox-notice';

// While argo has not added the read rule, Bridge home tells an account
// allowed as argo that nothing of argo's reaches them here, and where argo
// adds the rule (argo's inbox, section 4; Thomas, 1 Nov: the guide is
// linked from the notice).

describe("Bridge home's notice of argo's read rule", () => {
  it("says argo has not let the gateway read argo's inbox, names the gateway's ship the rule lets read, and links the guide", () => {
    expect(argoInboxNoticeOf({ kind: 'notLetRead', gatewayShip: { shipId: 'shp_01m3tbfspe96yf1rnr4ank9gtw', name: 'gateway' } })).toEqual({
      title: "What waits at argo does not reach you here",
      body: "argo has not let the gateway read argo's inbox, so what is sent to argo shows only in the console's inbox. argo adds a read rule on the console's Network page: from the gateway's ship, gateway, to argo.",
      guide: { label: 'How argo adds the read rule', href: ARGO_READ_RULE_GUIDE_URL },
    });
  });

  it('shows nothing otherwise', () => {
    expect(argoInboxNoticeOf({ kind: 'none' })).toBeNull();
  });

  it("links the guide in the gateway's docs", () => {
    expect(ARGO_READ_RULE_GUIDE_URL).toBe('https://github.com/ThomasHendrickx/aeolus-fleet-gateway/blob/main/docs/argo-inbox-read-rule.md');
  });
});
