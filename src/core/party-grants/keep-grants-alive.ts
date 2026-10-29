import type { Clock } from '../shared/clock.js';
import type { PartyGrants, SignInServers } from './ports.js';
import type { RefreshGrant } from './refresh-grant.js';

export type KeepGrantsAlive = () => Promise<void>;

/**
 * Use case: one round of the gateway keeping grants alive without a call
 * (decision 0067, Q7): every grant idle for longer than the idle time, or
 * whose access token is near its end, is refreshed with its party's client,
 * so a person who calls rarely stays signed in, and a grant lost is found,
 * and its person told, before a call needs it. A refresh not answered keeps
 * the grant as it was, to be tried again at the next round.
 */
export function createKeepGrantsAlive(deps: { grants: Pick<PartyGrants, 'due'>; servers: SignInServers; refreshGrant: RefreshGrant; clock: Clock }): KeepGrantsAlive {
  return async () => {
    for (const grant of await deps.grants.due({ now: deps.clock.now() })) {
      const server = await deps.servers.find(grant.fleetId, grant.party);
      if (server?.client !== null && server?.client !== undefined) {
        await deps.refreshGrant({ client: server.client, grant });
      }
    }
  };
}
