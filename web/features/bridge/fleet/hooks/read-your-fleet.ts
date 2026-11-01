import type { GatewayApi } from '../../../../lib/gateway-api/gateway-api';
import { refusalCodeOf, refusalMessageOf } from '../../../../lib/gateway-api/page-api';
import type { YourFleet } from '../services/your-fleet';

/**
 * What Bridge read of Your fleet: the fleet as the account reads it; that the
 * fleet does not let the account read it, so the panel is left out; or that
 * it cannot be read now, saying why.
 */
export type FleetRead = { kind: 'read'; value: YourFleet } | { kind: 'forbidden' } | { kind: 'unreadable'; message: string };

/** Your fleet, read through the gateway's API as the signed-in account; a sign-in that ended is thrown on, so the page sends the person to sign in again. */
export async function readYourFleet(api: GatewayApi): Promise<FleetRead> {
  try {
    return { kind: 'read', value: await api.people.yourFleet.query() };
  } catch (error) {
    const code = refusalCodeOf(error);
    if (code === 'FORBIDDEN') {
      return { kind: 'forbidden' };
    }
    if (code === 'UNAUTHORIZED') {
      throw error;
    }
    return { kind: 'unreadable', message: code === undefined ? 'The gateway did not answer.' : refusalMessageOf(error) };
  }
}
