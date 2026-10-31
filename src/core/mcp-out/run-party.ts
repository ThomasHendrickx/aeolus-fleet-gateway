import type { DeliveryId } from '@aeolus-fleet/common';

import type { McpServerParty } from '../parties/party.js';
import type { HandOutcome, ProxyShipCrew, PushedDelivery } from './hand-call.js';

/** Outbound port: waits the given time, or less once the signal aborts. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** The fleet's codes for a crew token it no longer takes: the gateway does not crew the proxy ship any more. */
const CREW_REFUSED = new Set(['UNAUTHORIZED', 'LEASE_ENDED']);

/** The fleet's code for a sealed fleet whose company key core cannot reach (decision 0068): nothing was claimed, the delivery waits. */
const KEY_UNAVAILABLE = 'KEY_UNAVAILABLE';

/** A party whose proxy ship's deliveries the gateway takes: its crew token, and the most it takes at once. */
interface TakingParty {
  readonly crewToken: string | null;
  readonly concurrencyLimit: number;
}

export type RunPartyOf<P extends TakingParty> = (input: { party: P; signal: AbortSignal }) => Promise<{ ended: 'stopped' | 'crewRefused' }>;

export type RunParty = RunPartyOf<McpServerParty>;

/**
 * Use case: the gateway takes the calls of a party's proxy ship, as its
 * crew, until it is stopped (interop 5.2). Each delivery pushReceive takes
 * is handed to the server once while in flight, with no more calls at once
 * than the party takes. A delivery answered again waits, longer each time,
 * before it is handed with the next number; the fleet counts each an
 * attempt and stops at the fifth. While the fleet answers only what the
 * gateway already holds, or does not answer, it looks again after a while.
 * What the party took up before it stopped is taken up first, in flight as
 * any delivery. While core cannot reach the fleet's company key
 * (KEY_UNAVAILABLE), nothing was claimed: it waits longer each time and goes
 * on once the key is back, never taking the proxy ship's crew as ended.
 */
export function createRunParty<P extends TakingParty = McpServerParty>(deps: {
  crew: Pick<ProxyShipCrew, 'pushReceive'>;
  handCall: (input: { party: P; delivery: PushedDelivery; signal: AbortSignal }) => Promise<HandOutcome>;
  /** What the party took up before it stopped and takes up first now, by delivery, as an outside agent's task it followed. */
  resume?: (input: { party: P; signal: AbortSignal }) => Promise<{ deliveryId: DeliveryId; hand: () => Promise<HandOutcome> }[]>;
  sleep: Sleep;
  pollMs: number;
  againWaitsMs: readonly number[];
}): RunPartyOf<P> {
  return async ({ party, signal }) => {
    const crewToken = party.crewToken;
    if (crewToken === null) {
      return { ended: 'crewRefused' };
    }
    const max = party.concurrencyLimit;
    const inFlight = new Map<DeliveryId, Promise<void>>();
    const agains = new Map<DeliveryId, number>();
    let keyUnavailableInARow = 0;

    const hand = async (deliveryId: DeliveryId, handOnce: () => Promise<HandOutcome>): Promise<void> => {
      let outcome: HandOutcome;
      try {
        outcome = await handOnce();
      } catch {
        // A failure of the gateway's own (its database): nothing was decided, so the delivery comes again.
        outcome = { kind: 'again' };
      }
      if (outcome.kind === 'again') {
        const count = (agains.get(deliveryId) ?? 0) + 1;
        agains.set(deliveryId, count);
        await deps.sleep(deps.againWaitsMs[Math.min(count, deps.againWaitsMs.length) - 1] ?? deps.pollMs, signal);
      } else {
        agains.delete(deliveryId);
      }
    };
    const startOne = (deliveryId: DeliveryId, handOnce: () => Promise<HandOutcome>) => {
      inFlight.set(
        deliveryId,
        hand(deliveryId, handOnce).finally(() => inFlight.delete(deliveryId)),
      );
    };
    const start = (delivery: PushedDelivery) => {
      startOne(delivery.deliveryId, () => deps.handCall({ party, delivery, signal }));
    };

    for (const resumed of (await deps.resume?.({ party, signal })) ?? []) {
      startOne(resumed.deliveryId, resumed.hand);
    }

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
      keyUnavailableInARow = !received.isOk && received.error.code === KEY_UNAVAILABLE ? keyUnavailableInARow + 1 : 0;
      const fresh = received.isOk ? received.value.filter((delivery) => !inFlight.has(delivery.deliveryId)).slice(0, max - inFlight.size) : [];
      fresh.forEach(start);
      if (fresh.length === 0) {
        const waitMs = keyUnavailableInARow === 0 ? deps.pollMs : (deps.againWaitsMs[Math.min(keyUnavailableInARow, deps.againWaitsMs.length) - 1] ?? deps.pollMs);
        await Promise.race([deps.sleep(waitMs, signal), ...inFlight.values()]);
      }
    }
    await Promise.all(inFlight.values());
    return { ended: 'stopped' };
  };
}
