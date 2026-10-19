import type { DeliveryId } from '@aeolus-fleet/common';

import type { McpServerParty } from '../parties/party.js';
import type { HandCall, HandOutcome, ProxyShipCrew, PushedDelivery } from './hand-call.js';

/** Outbound port: waits the given time, or less once the signal aborts. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** The fleet's codes for a crew token it no longer takes: the gateway does not crew the proxy ship any more. */
const CREW_REFUSED = new Set(['UNAUTHORIZED', 'LEASE_ENDED']);

export type RunParty = (input: { party: McpServerParty; signal: AbortSignal }) => Promise<{ ended: 'stopped' | 'crewRefused' }>;

/**
 * Use case: the gateway takes the calls of a party's proxy ship, as its
 * crew, until it is stopped (interop 5.2). Each delivery pushReceive takes
 * is handed to the server once while in flight, with no more calls at once
 * than the party takes. A delivery answered again waits, longer each time,
 * before it is handed with the next number; the fleet counts each an
 * attempt and stops at the fifth. While the fleet answers only what the
 * gateway already holds, or does not answer, it looks again after a while.
 */
export function createRunParty(deps: { crew: ProxyShipCrew; handCall: HandCall; sleep: Sleep; pollMs: number; againWaitsMs: readonly number[] }): RunParty {
  return async ({ party, signal }) => {
    const crewToken = party.crewToken;
    if (crewToken === null) {
      return { ended: 'crewRefused' };
    }
    const max = party.concurrencyLimit;
    const inFlight = new Map<DeliveryId, Promise<void>>();
    const agains = new Map<DeliveryId, number>();

    const hand = async (delivery: PushedDelivery): Promise<void> => {
      let outcome: HandOutcome;
      try {
        outcome = await deps.handCall({ party, delivery });
      } catch {
        // A failure of the gateway's own (its database): nothing was decided, so the delivery comes again.
        outcome = { kind: 'again' };
      }
      if (outcome.kind === 'again') {
        const count = (agains.get(delivery.deliveryId) ?? 0) + 1;
        agains.set(delivery.deliveryId, count);
        await deps.sleep(deps.againWaitsMs[Math.min(count, deps.againWaitsMs.length) - 1] ?? deps.pollMs, signal);
      } else {
        agains.delete(delivery.deliveryId);
      }
    };
    const start = (delivery: PushedDelivery) => {
      inFlight.set(
        delivery.deliveryId,
        hand(delivery).finally(() => inFlight.delete(delivery.deliveryId)),
      );
    };

    while (!signal.aborted) {
      if (inFlight.size >= max) {
        await Promise.race(inFlight.values());
        continue;
      }
      const received = await deps.crew.pushReceive(crewToken, { max, signal });
      if (!received.isOk && CREW_REFUSED.has(received.error.code)) {
        await Promise.all(inFlight.values());
        return { ended: 'crewRefused' };
      }
      const fresh = received.isOk ? received.value.filter((delivery) => !inFlight.has(delivery.deliveryId)).slice(0, max - inFlight.size) : [];
      fresh.forEach(start);
      if (fresh.length === 0) {
        await Promise.race([deps.sleep(deps.pollMs, signal), ...inFlight.values()]);
      }
    }
    await Promise.all(inFlight.values());
    return { ended: 'stopped' };
  };
}
