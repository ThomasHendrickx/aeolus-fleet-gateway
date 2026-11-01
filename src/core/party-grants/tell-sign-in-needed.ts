import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { CallSender } from '../mcp-in/ports.js';
import { STEP_CONTENT_TYPE } from '../people/item-job.js';
import type { GrantLost } from './party-grant.js';
import type { SignInNotices } from './ports.js';

/** Tells a person a call needs their sign-in to a party, or that their grant of it was lost, unless they were told since their last sign-in. */
export type TellSignInNeeded = (input: { fleetId: FleetId; party: string; personShipId: ShipId; lost: GrantLost | null }) => Promise<void>;

/** The page a person signs in to a party on, in a fleet. */
export type PageUrlOf = (fleetId: FleetId, party: string) => string;

/** The step that asks the person to sign in (Bridge, CC14): the notice's uuid its own, why it is needed, and the page to sign in on as its link. */
function stepOf({ noticeId, party, lost }: { noticeId: string; party: string; lost: GrantLost | null }, pageUrl: string): string {
  return JSON.stringify(
    lost === null
      ? {
          id: noticeId,
          title: `Sign in to ${party}`,
          why: `A ship of yours called ${party}, which calls under each person's own sign-in, and you are not signed in to it. Until you sign in, your ships' calls to ${party} are refused.`,
          link: pageUrl,
        }
      : {
          id: noticeId,
          title: `Sign in to ${party} again`,
          why: `Your sign-in to ${party} ended: ${party} refused to refresh it (${lost.why}). Until you sign in again, your ships' calls to ${party} are refused.`,
          link: pageUrl,
        },
  );
}

/**
 * Use case: the gateway's ship asks a person, by a step to their person
 * ship (Bridge, CC14), to sign in to a party a call needs their sign-in
 * to, or to sign in again when their grant of it was lost, with the page to
 * sign in on as its link (decision 0067, Q6, Q9): once per party, and again
 * only after a sign-in in between closes the notice. The notice's uuid is
 * the step's and keys the message, so one the fleet did not answer is sent
 * again at the next call and stored once; one it refused is not tried
 * again. The step's message is kept with the notice, so the sign-in
 * finishes the step.
 */
export function createTellSignInNeeded(deps: { notices: SignInNotices; connections: Pick<ConnectionStore, 'find'>; sender: CallSender; newNoticeId: () => string; pageUrlOf: PageUrlOf }): TellSignInNeeded {
  return async ({ fleetId, party, personShipId, lost }) => {
    const notice = await deps.notices.open(fleetId, { party, personShipId, noticeId: deps.newNoticeId() });
    const gateway = await deps.connections.find(fleetId);
    if (notice.isTold || gateway === undefined) {
      return;
    }
    const { noticeId } = notice;
    const sent = await deps.sender.send(gateway.crewToken, { to: personShipId, contentType: STEP_CONTENT_TYPE, payload: stepOf({ noticeId, party, lost }, deps.pageUrlOf(fleetId, party)), idempotencyKey: `party-sign-in:${noticeId}` });
    if (sent.isOk || sent.error.code !== 'UNAVAILABLE') {
      await deps.notices.markTold(fleetId, { party, personShipId, stepMessageId: sent.isOk ? sent.value.messageId : null });
    }
  };
}
