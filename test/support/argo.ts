/**
 * What argo and the fleet's other ships do in a test, through core's own
 * doors: argo signs in to the console and commissions ships with its session,
 * as the console's server does; a ship registers with its secret.
 */
import { commissionShipOutputSchema, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { OPERATOR, type FleetServer } from './fleet-server.js';

/** Signs argo in to the fleet's console: the session cookie the console's server forwards. */
export async function signIn(fleet: FleetServer): Promise<string> {
  const response = await fetch(`${fleet.url}/trpc/console.signIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: fleet.url },
    body: JSON.stringify({ email: OPERATOR.email, password: OPERATOR.password }),
  });
  const set = response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='));
  return z.string().parse(set).split(';')[0] ?? '';
}

const trpcAnswer = <T extends z.ZodType>(data: T) => z.object({ result: z.object({ data }) });

/** argo commissions a ship with its console session: its id and secret. */
export async function commission(
  fleet: FleetServer,
  argo: { cookie: string; ship: { name: string; type: string; scopes?: string[]; kind?: 'agent' | 'person' | 'app' } },
): Promise<{ shipId: ShipId; secret: string }> {
  const response = await fetch(`${fleet.url}/trpc/fleet.commission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: fleet.url, cookie: argo.cookie },
    body: JSON.stringify({ ...argo.ship, idempotencyKey: crypto.randomUUID() }),
  });
  const { shipId, secret } = trpcAnswer(commissionShipOutputSchema).parse(await response.json()).result.data;
  return { shipId, secret: z.string().parse(secret) };
}

/** A ship of the fleet registers with its secret, as a server: its crew token. */
export async function register(fleet: FleetServer, ship: { shipId: ShipId; secret: string }): Promise<string> {
  const response = await fetch(`${fleet.url}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...ship, location: { kind: 'SERVER' }, harness: 'test' }),
  });
  return z.object({ crewToken: z.string() }).parse(await response.json()).crewToken;
}

/** Commissions, crews and registers the fleet's networking plugin (decision 0035), as the networking plugin does when argo connects it. */
export async function registerNetworkingPlugin(fleet: FleetServer, cookie: string): Promise<void> {
  const ship = await commission(fleet, { cookie, ship: { name: 'networking-plugin', type: 'networking-plugin', scopes: ['fleet:read', 'fleet:network'] } });
  const crewToken = await register(fleet, ship);
  const response = await fetch(`${fleet.url}/api/v1/fleet/registerNetworkPlugin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
    body: JSON.stringify({ whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 }),
  });
  if (!response.ok) {
    throw new Error(`registerNetworkPlugin failed: ${await response.text()}`);
  }
}
