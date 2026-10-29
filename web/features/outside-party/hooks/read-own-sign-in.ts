/**
 * Your own sign-in to a server, as its page reads it through the API
 * (decision 0067, M2). The API refuses an account with no person ship in
 * the fleet (Q16): the page then names the fleet it needs one in.
 */
import type { GatewayApi } from '../../../lib/gateway-api/gateway-api';
import { refusalCodeOf, refusalMessageOf } from '../../../lib/gateway-api/page-api';
import type { OwnSignInRead } from '../ui/own-sign-in-card';

/** How the API refuses a person's own sign-in to an account with no person ship (src/adapters/trpc/router.ts, NOT_A_PERSON). */
const NOT_A_PERSON = 'FORBIDDEN';

/** The fleet's name as pagasae lists it, or plain words when it does not answer. */
async function fleetNameOf(api: GatewayApi, fleetId: string): Promise<string> {
  try {
    return (await api.account.apps.query()).fleets.find(({ id }) => id === fleetId)?.name ?? 'this fleet';
  } catch (error) {
    if (refusalCodeOf(error) === undefined) {
      throw error;
    }
    return 'this fleet';
  }
}

export async function readOwnSignIn({ api, fleetId, name }: { api: GatewayApi; fleetId: string; name: string }): Promise<OwnSignInRead> {
  try {
    return { kind: 'read', own: await api.parties.ownSignIn.query({ name }) };
  } catch (error) {
    if (refusalCodeOf(error) === NOT_A_PERSON) {
      return { kind: 'noPersonShip', fleetName: await fleetNameOf(api, fleetId) };
    }
    return { kind: 'refused', message: refusalMessageOf(error) };
  }
}
