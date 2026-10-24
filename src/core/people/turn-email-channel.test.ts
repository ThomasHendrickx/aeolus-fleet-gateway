import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryEmailChannels, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { ok } from '../shared/result.js';
import { createTurnEmailChannel } from './turn-email-channel.js';

// A person turns email on or off, to be woken when something waits for
// their person ship (wake a person, W8). It is kept by fleet and person ship.

const NOW = new Date('2026-10-23T09:00:00.000Z');
const SHIP_KEY = `${FLEET_ID}/${PERSON_SHIP_ID}`;

let crews: ReturnType<typeof memoryPersonCrews>;
let emailChannels: ReturnType<typeof memoryEmailChannels>;

beforeEach(() => {
  crews = memoryPersonCrews();
  emailChannels = memoryEmailChannels();
});

function turnEmailChannel(options: { isEmailOffered?: boolean } = {}) {
  return createTurnEmailChannel({ crewPersonShip: fakeCrewPersonShip(crews), emailChannels, isEmailOffered: options.isEmailOffered ?? true, clock: { now: () => NOW } });
}

describe('a person turns the email channel on and off', () => {
  it('turns it on for their own person ship', async () => {
    const turned = await turnEmailChannel()({ caller: CHARLOTTE_GRANT, isOn: true });

    expect({ turned, turnedOn: [...emailChannels.turnedOn] }).toEqual({ turned: ok(undefined), turnedOn: [[SHIP_KEY, NOW]] });
  });

  it('turns it off again', async () => {
    await turnEmailChannel()({ caller: CHARLOTTE_GRANT, isOn: true });

    await turnEmailChannel()({ caller: CHARLOTTE_GRANT, isOn: false });

    expect(emailChannels.turnedOn.size).toBe(0);
  });

  it('refuses to turn it on where the gateway cannot send email, keeping nothing', async () => {
    const turned = await turnEmailChannel({ isEmailOffered: false })({ caller: CHARLOTTE_GRANT, isOn: true });

    expect({ kind: turned.isOk ? undefined : turned.error.kind, turnedOn: emailChannels.turnedOn.size }).toEqual({ kind: 'CHANNEL_NOT_OFFERED', turnedOn: 0 });
  });

  it('is refused without a person ship, keeping nothing', async () => {
    const turned = await turnEmailChannel()({ caller: { fleetId: FLEET_ID, grantId: 'grant-of-argo' }, isOn: true });

    expect({ kind: turned.isOk ? undefined : turned.error.kind, turnedOn: emailChannels.turnedOn.size }).toEqual({ kind: 'NOT_A_PERSON', turnedOn: 0 });
  });
});
