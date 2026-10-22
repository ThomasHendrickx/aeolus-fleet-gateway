import { isPingContentType, RECEIVE_MAX_UPPER_BOUND } from '@aeolus-fleet/common';

import type { ConnectionStore, GatewayDelivery, GatewayInbox } from './ports.js';

/** What a round did: pings answered, other deliveries acked as kept by the fleet, and calls the fleet refused. */
export interface PingRound {
  ponged: number;
  acked: GatewayDelivery[];
  refused: number;
}

/** A round, ended early once the signal aborts. */
export type AnswerPings = (signal: AbortSignal) => Promise<PingRound>;

/**
 * Use case: the gateway's own ship takes what waits for it in each fleet it
 * is connected to, as any crewed ship does (blueprint, "Ping"): argo's ping
 * is answered with pong; anything else is acked, as the gateway's ship
 * handles no messages of its own, and the fleet keeps it in its history.
 */
export function createAnswerPings(deps: { connections: ConnectionStore; inbox: GatewayInbox }): AnswerPings {
  return async (signal) => {
    const round: PingRound = { ponged: 0, acked: [], refused: 0 };
    for (const crew of await deps.connections.connected()) {
      const taken = await deps.inbox.receive(crew.crewToken, { max: RECEIVE_MAX_UPPER_BOUND, signal });
      if (!taken.isOk) {
        round.refused += 1;
        continue;
      }
      for (const delivery of taken.value) {
        const isPing = isPingContentType(delivery.contentType);
        const answered = isPing ? await deps.inbox.pong(crew.crewToken, delivery.deliveryId) : await deps.inbox.ack(crew.crewToken, delivery.deliveryId);
        if (!answered.isOk) {
          round.refused += 1;
        } else if (isPing) {
          round.ponged += 1;
        } else {
          round.acked.push(delivery);
        }
      }
    }
    return round;
  };
}
