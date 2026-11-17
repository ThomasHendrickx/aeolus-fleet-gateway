/**
 * Use case: the gateway takes the replies to an outside client's calls, as
 * the crew of the client's proxy ship (Q9 a), until it is stopped. It asks
 * the fleet for the reply to each call it waits on with receiveReply
 * on its lease stream wakes and safety looks (aeolus-fleet#953): a call
 * neither completed nor past its deadline. While a call waits it also looks
 * again after pollMs, for receiveReply answers at once and no wake comes
 * when the fleet gives a delivery up (long-poll W5). Only
 * replies are taken, so a message to the proxy ship that replies to no call
 * waits in the fleet and keeps no reply out. The lease stays plain: the
 * fleet hands nothing to receiveReply on a pushed lease, so this never
 * pushReceives. A reply is kept on its call, then acknowledged and handled:
 * the gateway's store is the confirmation, so nothing is acknowledged before
 * it is kept. After each wait it reads where the call's delivery stands
 * with sentMessage and keeps it, so the call's state follows interop 3.4: a
 * delivery the fleet gave up fails the call, and it is waited on no more.
 * At most a few calls wait at once, each in its turn. An A2A client's calls
 * are taken the same way (decision 0060). While core cannot reach the
 * fleet's company key (KEY_UNAVAILABLE), nothing was claimed: it looks again
 * after a longer wait each time, and keeps the crew.
 */
import type { MessageId } from '@aeolus-fleet/common';

import type { ShipWakeups } from '../connection/ship-wakeups.js';

import type { ProxyShipCrew } from '../mcp-out/hand-call.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { A2aClientParty, McpClientParty } from '../parties/party.js';
import type { Clock } from '../shared/clock.js';
import { stateOf, type ClientCall } from './client-call.js';
import type { ClientCalls, ReplyReceiver, SentMessages } from './ports.js';

/** The fleet's codes for a crew token it no longer takes. */
const CREW_REFUSED = new Set(['UNAUTHORIZED', 'LEASE_ENDED']);

/** The fleet's code for a sealed fleet whose company key core cannot reach (decision 0068): nothing was claimed, the reply waits. */
const KEY_UNAVAILABLE = 'KEY_UNAVAILABLE';

/** The most calls whose reply the gateway waits on at once, for one party. */
const WAITING_MAX = 10;

export type CollectReplies = (input: { party: McpClientParty | A2aClientParty; signal: AbortSignal }) => Promise<{ ended: 'stopped' | 'crewRefused' }>;

interface CollectRepliesDeps {
  wakeups: ShipWakeups;
  crew: Pick<ProxyShipCrew, 'ack' | 'handled'>;
  replies: ReplyReceiver;
  sent: SentMessages;
  calls: ClientCalls;
  clock: Clock;
  sleep: Sleep;
  /** How long it waits before it looks again for calls to wait on. */
  pollMs: number;
  /** How long it waits before it looks again after each look in a row that the company key was not reachable; the last repeats. */
  againWaitsMs: readonly number[];
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
    const looks = deps.wakeups(crewToken, signal);
    try {
      const caller = { fleetId: party.fleetId, party: party.name };
      const waiting = new Map<MessageId, Promise<void>>();
      /** When each call was last asked for, so every call waited on gets its turn. */
      const askedAt = new Map<MessageId, number>();
      let asks = 0;
      /** Whether the fleet refused the crew token: set by a wait, read by the run. */
      const run = { isCrewRefused: false, isKeyUnavailable: false };
      let keyUnavailableInARow = 0;
      /** Whether a look after pollMs is already set: one at a time. */
      const lookAgain = { isSet: false };

      /** Asks the fleet once for the call's reply, and keeps it, then confirms it. */
      const waitOn = async (call: ClientCall): Promise<void> => {
        asks += 1;
        askedAt.set(call.messageId, asks);
        const received = await deps.replies.receiveReply(crewToken, { messageId: call.messageId, signal });
        const delivery = await deps.sent.sentMessage(crewToken, call.messageId);
        if (delivery.isOk) {
          const { state, since } = delivery.value;
          await deps.calls.setDelivery({ fleetId: call.fleetId, messageId: call.messageId }, { state, since });
        }
        if (!received.isOk) {
          if (CREW_REFUSED.has(received.error.code)) {
            run.isCrewRefused = true;
          }
          run.isKeyUnavailable ||= received.error.code === KEY_UNAVAILABLE;
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

      /** Whether a call of the party's still waits for its answer, after the look. */
      const isAnyWaiting = async (): Promise<boolean> => {
        const now = deps.clock.now();
        return (await deps.calls.waitedOn(caller, now)).some((call) => isWaiting(call, now));
      };

      /** A wait whose reply could not be kept: the run ends, and answers its failure. */
      const failed: Promise<void>[] = [];
      const canLook = () => !signal.aborted && !run.isCrewRefused;
      while (!signal.aborted && !run.isCrewRefused && failed.length === 0) {
        if (!(await looks.wait())) { break; }
        const now = deps.clock.now();
        const open = (await deps.calls.waitedOn(caller, now))
          .filter((call) => isWaiting(call, now) && !waiting.has(call.messageId))
          .sort((left, right) => (askedAt.get(left.messageId) ?? 0) - (askedAt.get(right.messageId) ?? 0));
        for (let offset = 0; offset < open.length && canLook(); offset += WAITING_MAX) {
          for (const call of open.slice(offset, offset + WAITING_MAX)) {
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
          await Promise.all(waiting.values());
        }
        keyUnavailableInARow = run.isKeyUnavailable ? keyUnavailableInARow + 1 : 0;

        const waitMs = keyUnavailableInARow === 0 ? deps.pollMs : (deps.againWaitsMs[Math.min(keyUnavailableInARow, deps.againWaitsMs.length) - 1] ?? deps.pollMs);
        if (run.isKeyUnavailable) {
          await deps.sleep(waitMs, signal);
          looks.request();
        } else if (open.length > 0 && !lookAgain.isSet && (await isAnyWaiting())) {
          // No wake comes when the fleet gives a call's delivery up, and receiveReply answers at once (long-poll W8): look again after pollMs, without holding back a wake meanwhile.
          lookAgain.isSet = true;
          void deps.sleep(deps.pollMs, signal).then(() => {
            lookAgain.isSet = false;
            looks.request();
          });
        }
        run.isKeyUnavailable = false;
      }
      await Promise.all([...waiting.values(), ...failed]);
      return { ended: run.isCrewRefused || looks.isEnded() ? 'crewRefused' : 'stopped' };
    } finally { looks.close(); }
  };
}
