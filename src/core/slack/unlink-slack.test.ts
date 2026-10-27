import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackLink, memorySlackLinks } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createUnlinkSlack } from './unlink-slack.js';

// Unlink on the Overview (gateway scopes 9.3): the account's own link goes,
// and the Slack user may link again.

const MATHILDE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-mathilde', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', accountToken: 'account-token-1', scopes: [] };

describe('unlinking Slack', () => {
  it("removes the account's own link, and only it", async () => {
    const links = memorySlackLinks();
    await links.add(aSlackLink());
    await links.add(aSlackLink({ accountId: 'acc-joris', slackUserId: 'U0JORIS' }));

    await createUnlinkSlack({ links })({ actor: MATHILDE });

    expect(links.held.map(({ accountId }) => accountId)).toEqual(['acc-joris']);
  });
});
