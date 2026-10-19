/**
 * Use case: the gateway takes the replies to an outside client's calls, as
 * the crew of the client's proxy ship (Q9 a), until it is stopped. A reply
 * naming a call is kept on it, then acknowledged and handled: the gateway's
 * store is the confirmation, so nothing is acknowledged before it is kept.
 * Any other delivery stays unacknowledged, for the inbox of a later slice.
 * Core 0.28's receiveReply (aeolus-fleet#953) takes this one's place.
 */
import type { ProxyShipCrew, PushedDelivery } from '../mcp-out/hand-call.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { McpClientParty } from '../parties/party.js';
import type { Clock } from '../shared/clock.js';
import type { ClientCalls } from './ports.js';

/** The fleet's codes for a crew token it no longer takes. */
const CREW_REFUSED = new Set(['UNAUTHORIZED', 'LEASE_ENDED']);

/** The most deliveries core's pushReceive takes at once. */
const PUSH_RECEIVE_MAX = 10;

export type CollectReplies = (input: { party: McpClientParty; signal: AbortSignal }) => Promise<{ ended: 'stopped' | 'crewRefused' }>;

interface CollectRepliesDeps {
  crew: Pick<ProxyShipCrew, 'pushReceive' | 'ack' | 'handled'>;
  calls: ClientCalls;
  clock: Clock;
  sleep: Sleep;
  /** How long it waits before it looks again, once a round took no reply. */
  pollMs: number;
}

export function createCollectReplies(deps: CollectRepliesDeps): CollectReplies {
  /** Keeps a reply that names one of the party's calls, then confirms it: whether it was taken. */
  const taken = async ({ party, crewToken }: { party: McpClientParty; crewToken: string }, delivery: PushedDelivery): Promise<boolean> => {
    if (delivery.inReplyTo === null) {
      return false;
    }
    const call = await deps.calls.findByMessage(party.fleetId, delivery.inReplyTo);
    if (call?.party !== party.name) {
      return false;
    }
    const { deliveryId, messageId, contentType, payload } = delivery;
    await deps.calls.addReply({ fleetId: party.fleetId, messageId: call.messageId }, { deliveryId, messageId, contentType, payload, receivedAt: deps.clock.now() });
    const acked = await deps.crew.ack(crewToken, deliveryId);
    if (!acked.isOk) {
      // Kept already: the fleet hands it again, and keeping it again changes nothing.
      return false;
    }
    await deps.crew.handled(crewToken, deliveryId);
    return true;
  };

  return async ({ party, signal }) => {
    const crewToken = party.crewToken;
    if (crewToken === null) {
      return { ended: 'crewRefused' };
    }
    while (!signal.aborted) {
      const received = await deps.crew.pushReceive(crewToken, { max: PUSH_RECEIVE_MAX, signal });
      if (!received.isOk && CREW_REFUSED.has(received.error.code)) {
        return { ended: 'crewRefused' };
      }
      const deliveries = received.isOk ? received.value : [];
      const outcomes = await Promise.all(deliveries.map((delivery) => taken({ party, crewToken }, delivery)));
      if (!outcomes.includes(true)) {
        await deps.sleep(deps.pollMs, signal);
      }
    }
    return { ended: 'stopped' };
  };
}
