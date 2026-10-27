import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import type { SlackLinks } from './ports.js';

export type StopSlackLink = (account: { fleetId: FleetId; accountId: string }) => Promise<void>;

/**
 * Use case: pagasae disabled the account (0055), so its Slack link stops
 * (gateway scopes 9.3). It is kept, stopped from when it first stopped, so
 * its Slack user is answered that the account cannot message the fleet now.
 */
export function createStopSlackLink(deps: { links: Pick<SlackLinks, 'stop'>; clock: Clock }): StopSlackLink {
  return ({ fleetId, accountId }) => deps.links.stop(fleetId, { accountId, at: deps.clock.now() });
}
