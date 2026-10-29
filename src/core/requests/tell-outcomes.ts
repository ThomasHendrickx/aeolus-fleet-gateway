import type { ConnectionStore } from '../connection/ports.js';
import type { CallSender } from '../mcp-in/ports.js';
import { textOf } from './outcome-notice.js';
import type { OutcomeNotices, PendingRequests } from './ports.js';

/** How many outcomes one round tells at most. */
const OUTCOMES_PER_ROUND = 50;

/** Tells the outcomes still to tell: how many the fleet stored, kept for the next round, and refused. */
export type TellOutcomes = () => Promise<{ told: number; kept: number; refused: number }>;

/**
 * Use case: the gateway's ship tells each person the outcome of their
 * request for an outside MCP server, by a text message to their person ship
 * (decision 0056, P5-2 a). The key is the request and the account, so an
 * outcome told again after the fleet did not answer is stored once (P5-3 a).
 * An outcome the fleet stored is ended and the account told; one it refused
 * is ended untold, so the gateway's page shows it; one it did not answer, or
 * of a fleet the gateway is not connected to, is kept for the next round.
 */
export function createTellOutcomes(deps: { notices: OutcomeNotices; requests: PendingRequests; connections: ConnectionStore; sender: CallSender }): TellOutcomes {
  return async () => {
    const counted = { told: 0, kept: 0, refused: 0 };
    for (const notice of await deps.notices.listUnended(OUTCOMES_PER_ROUND)) {
      const gateway = await deps.connections.find(notice.fleetId);
      if (gateway === undefined) {
        counted.kept += 1;
        continue;
      }
      const sent = await deps.sender.send(gateway.crewToken, { to: notice.personShipId, contentType: 'text/plain', payload: textOf(notice), idempotencyKey: `${notice.requestId}:${notice.accountId}` });
      if (!sent.isOk && sent.error.code === 'UNAVAILABLE') {
        counted.kept += 1;
        continue;
      }
      if (sent.isOk) {
        await deps.requests.markTold(notice.fleetId, { requestId: notice.requestId, accountId: notice.accountId });
        counted.told += 1;
      } else {
        counted.refused += 1;
      }
      await deps.notices.end(notice);
    }
    return counted;
  };
}
