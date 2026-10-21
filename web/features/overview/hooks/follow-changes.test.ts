import { FLEET_HEADER } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { upstreamHeadersOf } from './follow-changes';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';

describe("the Overview's live stream, as the web app's server follows it on the API", () => {
  it('forwards the shared sign-in alone, never the old page session or the console session, with the fleet the page names', () => {
    const asked = new Request(`http://gateway.test/overview/changes?fleet=${FLEET}`, { headers: { cookie: 'aeolus_gateway_session=old; aeolus_account_session=charlotte; aeolus_session=argo' } });

    expect(upstreamHeadersOf(asked)).toEqual({ accept: 'text/event-stream', cookie: 'aeolus_account_session=charlotte', [FLEET_HEADER]: FLEET });
  });

  it('forwards no cookie for a browser with no shared sign-in', () => {
    const asked = new Request(`http://gateway.test/overview/changes?fleet=${FLEET}`, { headers: { cookie: 'aeolus_session=argo' } });

    expect(upstreamHeadersOf(asked)).toEqual({ accept: 'text/event-stream', [FLEET_HEADER]: FLEET });
  });
});
