import type { Actor } from '../actors/authenticate-actor.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SlackLinks } from './ports.js';

export type ShowAllInSlack = (input: { actor: Actor; isOn: boolean }) => Promise<Result<undefined, DomainError<'NOT_LINKED'>>>;

/**
 * Use case: the person turns Show everything that waits in Slack on or off
 * (gateway scopes 9.6, B5): with it on, messages from ships that are not
 * bots show through the gateway's own bot too. Off until turned on (W8).
 */
export function createShowAllInSlack(deps: { links: Pick<SlackLinks, 'ofAccount' | 'showAll'> }): ShowAllInSlack {
  return async ({ actor, isOn }) => {
    const link = actor.kind === 'account' ? await deps.links.ofAccount(actor.fleetId, actor.accountId) : undefined;
    if (link === undefined) {
      return refuse('NOT_LINKED', 'Link your Slack account first');
    }
    await deps.links.showAll(link.fleetId, { accountId: link.accountId, isOn });
    return ok(undefined);
  };
}
