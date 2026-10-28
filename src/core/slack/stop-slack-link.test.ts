import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackLink, memorySlackLinks } from '../../../test/support/slack-fakes.js';
import { createStopSlackLink } from './stop-slack-link.js';

// A disabled account (0055): its links stop (gateway scopes 9.3), so its
// Slack user is answered that it cannot message the fleet now.

const NOW = new Date('2026-10-27T09:00:00.000Z');

describe("a disabled account's Slack link", () => {
  it('stops, kept so its Slack user is answered why', async () => {
    const links = memorySlackLinks();
    await links.add(aSlackLink());

    await createStopSlackLink({ links, clock: { now: () => NOW } })({ fleetId: FLEET_ID, accountId: 'acc-mathilde' });

    expect(links.held).toEqual([aSlackLink({ stoppedAt: NOW })]);
  });

  it('stays stopped from when it first stopped, told again', async () => {
    const links = memorySlackLinks();
    const stoppedAt = new Date('2026-10-27T08:00:00.000Z');
    await links.add(aSlackLink({ stoppedAt }));

    await createStopSlackLink({ links, clock: { now: () => NOW } })({ fleetId: FLEET_ID, accountId: 'acc-mathilde' });

    expect(links.held[0]?.stoppedAt).toEqual(stoppedAt);
  });
});
