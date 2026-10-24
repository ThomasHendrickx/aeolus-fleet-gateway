import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aWebPushSubscription, CHARLOTTE_GRANT, fakeCrewPersonShip, memoryEmailChannels, memoryPersonCrews, memoryWebPushSubscriptions } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { ok } from '../shared/result.js';
import { createReadWakeChannels } from './read-wake-channels.js';

// A person sees which channels wake them when something waits for their
// person ship (wake a person, W8): nothing is on by default.

let crews: ReturnType<typeof memoryPersonCrews>;
let emailChannels: ReturnType<typeof memoryEmailChannels>;
let subscriptions: ReturnType<typeof memoryWebPushSubscriptions>;

/** The gateway's public push key, which a browser subscribes with. */
const WEB_PUSH_KEY = 'BGatewayPublicKey';
const NO_WEB_PUSH = { webPush: { publicKey: WEB_PUSH_KEY, browsers: [] } };

beforeEach(() => {
  crews = memoryPersonCrews();
  emailChannels = memoryEmailChannels();
  subscriptions = memoryWebPushSubscriptions();
});

function readWakeChannels(options: { isEmailOffered?: boolean; webPushKey?: string | null } = {}) {
  return createReadWakeChannels({
    crewPersonShip: fakeCrewPersonShip(crews),
    emailChannels,
    isEmailOffered: options.isEmailOffered ?? true,
    subscriptions,
    webPushKey: options.webPushKey === undefined ? WEB_PUSH_KEY : options.webPushKey,
  });
}

describe('a person reads the channels that wake them', () => {
  it('has email off until they turn it on', async () => {
    await expect(readWakeChannels()(CHARLOTTE_GRANT)).resolves.toEqual(ok({ email: { isOffered: true, isOn: false }, ...NO_WEB_PUSH }));
  });

  it('has email on once they turned it on for their person ship', async () => {
    await emailChannels.turn({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }, { isOn: true, at: new Date('2026-10-23T09:00:00.000Z') });

    await expect(readWakeChannels()(CHARLOTTE_GRANT)).resolves.toEqual(ok({ email: { isOffered: true, isOn: true }, ...NO_WEB_PUSH }));
  });

  it('is offered no email where the gateway cannot send it', async () => {
    await expect(readWakeChannels({ isEmailOffered: false })(CHARLOTTE_GRANT)).resolves.toEqual(ok({ email: { isOffered: false, isOn: false }, ...NO_WEB_PUSH }));
  });

  it("is offered web push with the gateway's push key, and lists the browsers they turned it on in, oldest first, saying which is gone, never their keys", async () => {
    const addedAt = new Date('2026-10-23T09:00:00.000Z');
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/firefox', addedAt }));
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/chrome', browser: 'Chrome on macOS', addedAt: new Date(addedAt.getTime() + 1), goneAt: addedAt }));
    await subscriptions.save(aWebPushSubscription({ shipId: 'shp_01m3tb1zgr5h2ffee12xnch8zz', endpoint: 'https://push.example/someone-else' }));

    const read = await readWakeChannels()(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.webPush).toEqual({
      publicKey: WEB_PUSH_KEY,
      browsers: [
        { endpoint: 'https://push.example/firefox', browser: 'Firefox on Linux', addedAt, isGone: false },
        { endpoint: 'https://push.example/chrome', browser: 'Chrome on macOS', addedAt: new Date(addedAt.getTime() + 1), isGone: true },
      ],
    });
  });

  it('is offered no web push where the gateway holds no push keys', async () => {
    const read = await readWakeChannels({ webPushKey: null })(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.webPush).toEqual({ publicKey: null, browsers: [] });
  });

  it('is refused without a person ship', async () => {
    const read = await readWakeChannels()({ fleetId: FLEET_ID, grantId: 'grant-of-argo' });

    expect(read.isOk ? undefined : read.error.kind).toBe('NOT_A_PERSON');
  });
});
