import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { Actor } from './authenticate-actor.js';
import { createCredentialOf } from './credential-of.js';

// The gateway calls the fleet as the actor who called it (decision 0057), so
// the fleet answers what that actor may do: a ship by its own crew token,
// argo or a viewer by the console session, and an account signed in with the
// shared sign-in by its account token, presented by the gateway's ship.

const GATEWAY_CREW = 'aeolus_ct_v1_gateway';
const CHARLOTTE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID, accountToken: 'account-token-9', scopes: ['fleet:network'] };

let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: GATEWAY_CREW, crewedAt: new Date('2026-10-20T09:00:00.000Z') });
});

function credentialOf() {
  return createCredentialOf({ connections });
}

describe('the credential the gateway calls the fleet with, as the actor', () => {
  it("is the token pagasae exchanged the shared sign-in for, presented by the gateway's ship", async () => {
    await expect(credentialOf()(CHARLOTTE, {})).resolves.toEqual({ isOk: true, value: { crewToken: GATEWAY_CREW, accountToken: 'account-token-9' } });
  });

  it("is a ship's own crew token, or argo's console session, as they sent it", async () => {
    const ship: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: SHIP_ID, scopes: [] };
    const argo: Actor = { fleetId: FLEET_ID, kind: 'operator', scopes: [] };

    await expect(Promise.all([credentialOf()(ship, { crewToken: 'aeolus_ct_v1_agent' }), credentialOf()(argo, { cookie: 'aeolus_session=argo' })])).resolves.toEqual([
      { isOk: true, value: { crewToken: 'aeolus_ct_v1_agent' } },
      { isOk: true, value: { cookie: 'aeolus_session=argo' } },
    ]);
  });

  it('is the console session an account sent, as it sent it: the fleet takes its cookie as the account token (decision 0057)', async () => {
    const byConsole: Actor = { ...CHARLOTTE, personShipId: null, accountToken: null };

    await expect(credentialOf()(byConsole, { cookie: 'aeolus_session=charlotte' })).resolves.toEqual({ isOk: true, value: { cookie: 'aeolus_session=charlotte' } });
  });

  it('refuses an account of a fleet the gateway is no longer connected to', async () => {
    await connections.drop(FLEET_ID);

    await expect(credentialOf()(CHARLOTTE, {})).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
