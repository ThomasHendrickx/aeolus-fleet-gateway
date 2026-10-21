/**
 * Use case: the gateway takes the replies to an outside client's calls, as
 * the crew of the client's proxy ship (Q9 a), until it is stopped. It asks
 * the fleet for the reply to each call it waits on with receiveReply
 * (aeolus-fleet#953): a call neither completed nor past its deadline. Only
 * replies are taken, so a message to the proxy ship that replies to no call
 * waits in the fleet and keeps no reply out. The lease stays plain: the
 * fleet hands nothing to receiveReply on a pushed lease, so this never
 * pushReceives. A reply is kept on its call, then acknowledged and handled:
 * the gateway's store is the confirmation, so nothing is acknowledged before
 * it is kept. At most a few calls wait at once, each in its turn.
 */
import type { MessageId } from '@aeolus-fleet/common';

import type { ProxyShipCrew } from '../mcp-out/hand-call.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { McpClientParty } from '../parties/party.js';
import type { Clock } from '../shared/clock.js';
import { stateOf, type ClientCall } from './client-call.js';
import type { ClientCalls, ReplyReceiver } from './ports.js';

/** The fleet's codes for a crew token it no longer takes. */
const CREW_REFUSED = new Set(['UNAUTHORIZED', 'LEASE_ENDED']);

/** The most calls whose reply the gateway waits on at once, for one party. */
const WAITING_MAX = 10;

export type CollectReplies = (input: { party: McpClientParty; signal: AbortSignal }) => Promise<{ ended: 'stopped' | 'crewRefused' }>;

interface CollectRepliesDeps {
  crew: Pick<ProxyShipCrew, 'ack' | 'handled'>;
  replies: ReplyReceiver;
  calls: ClientCalls;
  clock: Clock;
  sleep: Sleep;
  /** How long it waits before it looks again for calls to wait on. */
  pollMs: number;
}

/** Whether the call still waits for its answer: neither completed nor failed at its deadline. */
function isWaiting(call: ClientCall, now: Date): boolean {
  const { state } = stateOf(call, now);
  return state === 'submitted' || state === 'working';
}

export function createCollectReplies(deps: CollectRepliesDeps): CollectReplies {
  return async ({ party, signal }) => {
    const crewToken = party.crewToken;
    if (crewToken === null) {
      return { ended: 'crewRefused' };
    }
    const caller = { fleetId: party.fleetId, party: party.name };
    const waiting = new Map<MessageId, Promise<void>>();
    /** When each call was last asked for, so every call waited on gets its turn. */
    const askedAt = new Map<MessageId, number>();
    let asks = 0;
    /** Whether the fleet refused the crew token: set by a wait, read by the run. */
    const run = { isCrewRefused: false };

    /** Asks the fleet once for the call's reply, and keeps it, then confirms it. */
    const waitOn = async (call: ClientCall): Promise<void> => {
      asks += 1;
      askedAt.set(call.messageId, asks);
      const received = await deps.replies.receiveReply(crewToken, { messageId: call.messageId, signal });
      if (!received.isOk) {
        if (CREW_REFUSED.has(received.error.code)) {
          run.isCrewRefused = true;
        }
        return;
      }
      const reply = received.value;
      if (reply === undefined) {
        return;
      }
      await deps.calls.addReply({ fleetId: call.fleetId, messageId: call.messageId }, { ...reply, receivedAt: deps.clock.now() });
      // Kept already: an acknowledgement the fleet did not take hands the reply again, and keeping it again changes nothing.
      if ((await deps.crew.ack(crewToken, reply.deliveryId)).isOk) {
        await deps.crew.handled(crewToken, reply.deliveryId);
      }
    };

    /** A wait whose reply could not be kept: the run ends, and answers its failure. */
    const failed: Promise<void>[] = [];
    while (!signal.aborted && !run.isCrewRefused && failed.length === 0) {
      const now = deps.clock.now();
      const open = (await deps.calls.waitedOn(caller, now))
        .filter((call) => isWaiting(call, now) && !waiting.has(call.messageId))
        .sort((left, right) => (askedAt.get(left.messageId) ?? 0) - (askedAt.get(right.messageId) ?? 0));
      for (const call of open.slice(0, WAITING_MAX - waiting.size)) {
        const waited = waitOn(call);
        waiting.set(
          call.messageId,
          waited
            .catch(() => {
              failed.push(waited);
            })
            .finally(() => waiting.delete(call.messageId)),
        );
      }
      await deps.sleep(deps.pollMs, signal);
    }
    await Promise.all([...waiting.values(), ...failed]);
    return { ended: run.isCrewRefused ? 'crewRefused' : 'stopped' };
  };
}
