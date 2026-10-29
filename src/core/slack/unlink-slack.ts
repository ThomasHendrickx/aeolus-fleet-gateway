import type { Actor } from '../actors/authenticate-actor.js';
import type { SlackLinks } from './ports.js';

export type UnlinkSlack = (input: { actor: Actor }) => Promise<void>;

/** Use case: Unlink on the Overview (gateway scopes 9.3): the account's own link goes, and its Slack user may link again. */
export function createUnlinkSlack(deps: { links: Pick<SlackLinks, 'remove'> }): UnlinkSlack {
  return async ({ actor }) => {
    if (actor.kind === 'account') {
      await deps.links.remove(actor.fleetId, actor.accountId);
    }
  };
}
