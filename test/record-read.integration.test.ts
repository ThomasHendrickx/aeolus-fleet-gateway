import { NOTICE_CONTENT_TYPE, STEP_CONTENT_TYPE, STEP_WITHDRAWAL_CONTENT_TYPE } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import type { PersonShipDoor } from '../src/core/people/ports.js';
import { commission, register, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// Done reads the person ship's record from a real core (ship.record, Bridge
// B1): a page of deliveries newest first, each with its state, and the step
// and notice messages read as common words them (B2).

const STEP_ID = '6f1c0a52-3d0e-4c53-9a47-2a4f1f0d9b11';

let fleet: FleetServer;
let door: PersonShipDoor;
let charlotteCrew: string;
let tracker: string;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const cookie = await signIn(fleet);
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  charlotteCrew = await register(fleet, charlotte);
  tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: 'tracker', type: 'issue-tracker', kind: 'app' } }));
  door = createRestFleetDoor(fleet.url).person;
}, 120_000);

afterAll(async () => {
  await fleet.stop();
});

async function trackerSends(contentType: string, payload: unknown): Promise<void> {
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType, payload: JSON.stringify(payload), idempotencyKey: crypto.randomUUID() }),
  });
  expect(sent.status).toBe(200);
}

describe('the person ship record, read from a real core', () => {
  it('lists a step, its withdrawal and a notice newest first, each with its state and what it names', async () => {
    await trackerSends(STEP_CONTENT_TYPE, { id: STEP_ID, title: 'Sign in to the tracker', why: 'It needs your account', link: 'https://tracker.example/sign-in' });
    await trackerSends(STEP_WITHDRAWAL_CONTENT_TYPE, { stepId: STEP_ID });
    await trackerSends(NOTICE_CONTENT_TYPE, { headline: 'Release out', body: 'v1 is out' });
    const taken = await door.pushReceive(charlotteCrew, { max: 3 });
    expect(taken.isOk ? taken.value.length : 0).toBe(3);
    for (const { deliveryId } of taken.isOk ? taken.value : []) {
      await door.ack(charlotteCrew, deliveryId);
      await door.handled(charlotteCrew, deliveryId);
    }

    const page = await door.record(charlotteCrew, { cursor: null, limit: 20 });

    expect(page.isOk ? page.value.items.map(({ contentType, state, headline, stepId, withdrawnStepId, stepLink }) => ({ contentType, state, headline, stepId, withdrawnStepId, stepLink })) : page).toEqual([
      { contentType: NOTICE_CONTENT_TYPE, state: 'handled', headline: 'Release out', stepId: null, withdrawnStepId: null, stepLink: null },
      { contentType: STEP_WITHDRAWAL_CONTENT_TYPE, state: 'handled', headline: null, stepId: null, withdrawnStepId: STEP_ID, stepLink: null },
      { contentType: STEP_CONTENT_TYPE, state: 'handled', headline: 'Sign in to the tracker', stepId: STEP_ID, withdrawnStepId: null, stepLink: 'https://tracker.example/sign-in' },
    ]);
    expect(page.isOk ? page.value.nextCursor : 'refused').toBeNull();
  });
});
