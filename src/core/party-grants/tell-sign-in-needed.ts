import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { CallSender } from '../mcp-in/ports.js';
import type { SignInNotices } from './ports.js';

/** Tells a person a call needs their sign-in to a party, unless they were told since their last sign-in. */
export type TellSignInNeeded = (input: { fleetId: FleetId; party: string; personShipId: ShipId }) => Promise<void>;

/** The page a person signs in to a party on, in a fleet. */
export type PageUrlOf = (fleetId: FleetId, party: string) => string;

function textOf(party: string, pageUrl: string): string {
  return `A ship of yours called ${party}, which calls under each person's own sign-in, and you are not signed in to it. Sign in on ${pageUrl}; until then your ships' calls to ${party} are refused.`;
}

/**
 * Use case: the gateway's ship tells a person, by a text message to their
 * person ship, that a call needs their sign-in to a party, with the page to
 * sign in on (decision 0067, Q6, Q9): once per party, and again only after a
 * sign-in in between closes the notice. The notice's id keys the message, so
 * one the fleet did not answer is sent again at the next call and stored
 * once; one it refused is not tried again.
 */
export function createTellSignInNeeded(deps: { notices: SignInNotices; connections: Pick<ConnectionStore, 'find'>; sender: CallSender; newNoticeId: () => string; pageUrlOf: PageUrlOf }): TellSignInNeeded {
  return async ({ fleetId, party, personShipId }) => {
    const notice = await deps.notices.open(fleetId, { party, personShipId, noticeId: deps.newNoticeId() });
    const gateway = await deps.connections.find(fleetId);
    if (notice.isTold || gateway === undefined) {
      return;
    }
    const sent = await deps.sender.send(gateway.crewToken, { to: personShipId, contentType: 'text/plain', payload: textOf(party, deps.pageUrlOf(fleetId, party)), idempotencyKey: `party-sign-in:${notice.noticeId}` });
    if (sent.isOk || sent.error.code !== 'UNAVAILABLE') {
      await deps.notices.markTold(fleetId, { party, personShipId });
    }
  };
}
