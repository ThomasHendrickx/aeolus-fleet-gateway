import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryEmailChannels, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { ok } from '../shared/result.js';
import { createReadWakeChannels } from './read-wake-channels.js';

// A person sees which channels wake them when something waits for their
// person ship (wake a person, W8): nothing is on by default.

let crews: ReturnType<typeof memoryPersonCrews>;
let emailChannels: ReturnType<typeof memoryEmailChannels>;

beforeEach(() => {
  crews = memoryPersonCrews();
  emailChannels = memoryEmailChannels();
});

function readWakeChannels(options: { isEmailOffered?: boolean } = {}) {
  return createReadWakeChannels({ crewPersonShip: fakeCrewPersonShip(crews), emailChannels, isEmailOffered: options.isEmailOffered ?? true });
}

describe('a person reads the channels that wake them', () => {
  it('has email off until they turn it on', async () => {
    await expect(readWakeChannels()(CHARLOTTE_GRANT)).resolves.toEqual(ok({ email: { isOffered: true, isOn: false } }));
  });

  it('has email on once they turned it on for their person ship', async () => {
    await emailChannels.turn({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }, { isOn: true, at: new Date('2026-10-23T09:00:00.000Z') });

    await expect(readWakeChannels()(CHARLOTTE_GRANT)).resolves.toEqual(ok({ email: { isOffered: true, isOn: true } }));
  });

  it('is offered no email where the gateway cannot send it', async () => {
    await expect(readWakeChannels({ isEmailOffered: false })(CHARLOTTE_GRANT)).resolves.toEqual(ok({ email: { isOffered: false, isOn: false } }));
  });

  it('is refused without a person ship', async () => {
    const read = await readWakeChannels()({ fleetId: FLEET_ID, grantId: 'grant-of-argo' });

    expect(read.isOk ? undefined : read.error.kind).toBe('NOT_A_PERSON');
  });
});
