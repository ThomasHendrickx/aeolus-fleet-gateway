import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackLink, memorySlackLinks } from '../../../test/support/slack-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { err } from '../shared/result.js';
import { createShowAllInSlack } from './show-all-in-slack.js';

// The Overview's switch, Show everything that waits in Slack (gateway
// scopes 9.6, B5): off until the person turns it on (W8); only a linked
// account has it.

const MATHILDE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-mathilde', personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', accountToken: 'account-token-1', scopes: [] };

describe('Show everything that waits in Slack', () => {
  it("turns on and off for the person's own link", async () => {
    const links = memorySlackLinks();
    await links.add(aSlackLink());

    await createShowAllInSlack({ links })({ actor: MATHILDE, isOn: true });
    const wasTurnedOn = links.held[0]?.isShowingAll;
    await createShowAllInSlack({ links })({ actor: MATHILDE, isOn: false });

    expect([wasTurnedOn, links.held[0]?.isShowingAll]).toEqual([true, false]);
  });

  it('refuses an account whose Slack account is not linked', async () => {
    await expect(createShowAllInSlack({ links: memorySlackLinks() })({ actor: MATHILDE, isOn: true })).resolves.toEqual(err({ kind: 'NOT_LINKED', message: 'Link your Slack account first' }));
  });
});
