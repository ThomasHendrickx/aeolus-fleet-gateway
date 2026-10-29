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

/** Applies the fleet's own network rules, an empty list, as an actor holding fleet:network does: the open rule goes off, so only the built-in and declared rules reach (decisions 0034, 0035). */
export async function applyEmptyOwnRules(fleet: FleetServer, cookie: string): Promise<void> {
  const crewToken = await register(fleet, await commission(fleet, { cookie, ship: { name: 'network-admin', type: 'agent', scopes: ['fleet:read', 'fleet:network'] } }));
  const call = async (procedure: string, body: unknown): Promise<unknown> => {
    const response = await fetch(`${fleet.url}/api/v1/fleet/${procedure}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${procedure} failed: ${await response.text()}`);
    }
    return response.json();
  };
  const { savedAgainstVersion } = z.object({ savedAgainstVersion: z.number() }).parse(await call('saveNetworkRulesDraft', { rules: [] }));
  await call('applyNetworkRules', { version: savedAgainstVersion });
}

/** argo calls one of the fleet's mutations with its console session, as the console does; it throws when the fleet refuses. */
async function argoMutates(fleet: FleetServer, call: { cookie: string; procedure: string; input: unknown }): Promise<void> {
  const response = await fetch(`${fleet.url}/trpc/fleet.${call.procedure}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: fleet.url, cookie: call.cookie },
    body: JSON.stringify(call.input),
  });
  if (!response.ok) {
    throw new Error(`${call.procedure} failed: ${await response.text()}`);
  }
}

/** argo defines one of the fleet's own scopes (scopes:define, gateway scopes 4.1), which argo then holds and grants onwards. */
export async function defineScope(fleet: FleetServer, argo: { cookie: string; scope: string; description: string }): Promise<void> {
  await argoMutates(fleet, { cookie: argo.cookie, procedure: 'defineScope', input: { scope: argo.scope, description: argo.description } });
}

/** argo grants and revokes scopes on a live ship (scopes:grant), effective at the ship's next call (decision 0046). */
export async function grantScopes(fleet: FleetServer, argo: { cookie: string; shipId: ShipId; grant: string[]; revoke: string[] }): Promise<void> {
  await argoMutates(fleet, { cookie: argo.cookie, procedure: 'grantScopes', input: { shipId: argo.shipId, grant: argo.grant, revoke: argo.revoke } });
}

/** argo makes a person ship, or argo itself, a ship's owner (fleet:owner, decision 0045). */
export async function setOwner(fleet: FleetServer, argo: { cookie: string; shipId: ShipId; ownerShipId: ShipId }): Promise<void> {
  await argoMutates(fleet, { cookie: argo.cookie, procedure: 'setOwner', input: { shipId: argo.shipId, ownerShipId: argo.ownerShipId } });
}

/** argo retires a ship (fleet:manage): it stays retired (decision 0056). */
export async function retire(fleet: FleetServer, argo: { cookie: string; shipId: ShipId }): Promise<void> {
  await argoMutates(fleet, { cookie: argo.cookie, procedure: 'retire', input: { shipId: argo.shipId } });
}
