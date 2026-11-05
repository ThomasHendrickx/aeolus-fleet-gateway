import type { GatewayApi } from '../../../../lib/gateway-api/gateway-api';

/**
 * How many ships have an alert, for the shell of every page: the number the
 * fleet counts, one read however many ships there are. Undefined when the
 * account may not read the fleet or the count cannot be read now.
 */
export async function readFleetAlertCount(api: GatewayApi): Promise<number | undefined> {
  try {
    return (await api.people.fleetAlertCount.query()).count;
  } catch {
    return undefined;
  }
}
