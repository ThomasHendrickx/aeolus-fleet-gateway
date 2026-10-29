import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryFleetSwitches, memoryForgetter, memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { createDeleteFleet } from './delete-fleet.js';

const AT = new Date('2026-10-18T12:00:00.000Z');

let switches: ReturnType<typeof memoryFleetSwitches>;
let requests: ReturnType<typeof memoryInstallationRequests>;
let forgetter: ReturnType<typeof memoryForgetter>;
let deleteFleet: ReturnType<typeof createDeleteFleet>;

beforeEach(async () => {
  switches = memoryFleetSwitches();
  requests = memoryInstallationRequests();
  forgetter = memoryForgetter({ switches, requests });
  deleteFleet = createDeleteFleet({ forgetter, requests, hasher: plainHasher, clock: { now: () => AT } });
  await switches.set(FLEET_ID, { isEnabled: true, at: AT });
});

describe('deleting a fleet from the gateway (decision 0021)', () => {
  it('forgets everything the gateway holds of the fleet', async () => {
    await expect(deleteFleet({ requestId: 'd-1', fleetId: FLEET_ID })).resolves.toEqual({ isOk: true, value: {} });
    expect([forgetter.forgotten, switches.held.has(FLEET_ID)]).toEqual([[FLEET_ID], false]);
  });

  it('keeps the request as its hash only, naming nothing of the fleet', async () => {
    await deleteFleet({ requestId: 'd-1', fleetId: FLEET_ID });

    expect(requests.held).toEqual([{ requestId: 'd-1', kind: 'deleteFleet', requestHash: `hash(deleteFleet ${FLEET_ID})`, fleetId: null, isEnabled: null, at: AT }]);
  });

  it('answers a replay with its first answer, forgetting nothing again', async () => {
    await deleteFleet({ requestId: 'd-1', fleetId: FLEET_ID });

    await expect(deleteFleet({ requestId: 'd-1', fleetId: FLEET_ID })).resolves.toEqual({ isOk: true, value: {} });
    expect(forgetter.forgotten).toEqual([FLEET_ID]);
  });

  it('refuses a request id used for another request', async () => {
    await requests.record({ requestId: 'd-1', kind: 'setEnabled', requestHash: 'hash(other)', fleetId: FLEET_ID, isEnabled: true, at: AT });

    await expect(deleteFleet({ requestId: 'd-1', fleetId: FLEET_ID })).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
  });
});
