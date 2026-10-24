import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeResolver } from '../../../test/support/a2a-push-fakes.js';
import { aWebPushSubscription, CHARLOTTE_GRANT, fakeCrewPersonShip, memoryPersonCrews, memoryWebPushSubscriptions } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createTurnOffWebPush } from './turn-off-web-push.js';
import { createTurnOnWebPush } from './turn-on-web-push.js';

// A person turns web push on for a browser on the overview, and removes a
// browser (wake a person, W8). Nothing is on by default.

const SHIP = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const AT = new Date('2026-10-23T10:00:00.000Z');
/** A browser's push keys as its PushSubscription states them: a P-256 public key of 65 bytes and an auth secret of 16, base64url. */
const KEYS = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };
const FIREFOX = { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/firefox-1', keys: KEYS, browser: 'Firefox on Linux' };
const CALLER = CHARLOTTE_GRANT;

let crews: ReturnType<typeof memoryPersonCrews>;
let subscriptions: ReturnType<typeof memoryWebPushSubscriptions>;

beforeEach(() => {
  crews = memoryPersonCrews();
  subscriptions = memoryWebPushSubscriptions();
});

/** How the push services' hosts resolve: Mozilla's and the tests' own at public addresses, the rest as each test names them. */
const HOSTS = {
  'updates.push.services.mozilla.com': ['34.117.237.239'],
  'push.example': ['93.184.215.14'],
  'inside.example': ['10.0.0.7'],
  'mixed.example': ['93.184.215.14', '192.168.1.20'],
  'metadata.example': ['169.254.169.254'],
};

const turnOn = (options: { isWebPushOffered?: boolean } = {}) =>
  createTurnOnWebPush({ crewPersonShip: fakeCrewPersonShip(crews), subscriptions, resolver: fakeResolver(HOSTS), isWebPushOffered: options.isWebPushOffered ?? true, clock: { now: () => AT } });

describe('a person turns web push on for a browser', () => {
  it('keeps it for their person ship, with the fleet name its wakes say', async () => {
    await expect(turnOn()({ caller: CALLER, fleetName: 'Acme', ...FIREFOX })).resolves.toEqual({ isOk: true, value: undefined });

    expect(subscriptions.held).toEqual([{ ...SHIP, ...FIREFOX, fleetName: 'Acme', addedAt: AT, goneAt: null }]);
  });

  it('takes keys with their base64 padding', async () => {
    const padded = { p256dh: `${KEYS.p256dh}=`, auth: `${KEYS.auth}==` };

    await expect(turnOn()({ caller: CALLER, fleetName: 'Acme', ...FIREFOX, keys: padded })).resolves.toMatchObject({ isOk: true });
  });

  it('keeps a browser turned on again anew, as it is no longer gone', async () => {
    await subscriptions.save(aWebPushSubscription({ endpoint: FIREFOX.endpoint, goneAt: new Date('2026-10-22T09:00:00.000Z') }));

    await turnOn()({ caller: CALLER, fleetName: 'Acme', ...FIREFOX });

    expect(subscriptions.held.map(({ goneAt }) => goneAt)).toEqual([null]);
  });

  it.each([
    ['an endpoint that is no https URL', { endpoint: 'http://push.example/firefox' }],
    ['an endpoint that is no URL', { endpoint: 'firefox' }],
    ['an endpoint over 2048 characters', { endpoint: `https://push.example/${'a'.repeat(2028)}` }],
    ['a public key of 64 bytes', { keys: { ...KEYS, p256dh: `B${'A'.repeat(84)}` } }],
    ['an auth secret of 17 bytes', { keys: { ...KEYS, auth: 'A'.repeat(23) } }],
    ['a key that is no base64url', { keys: { ...KEYS, auth: `${'A'.repeat(21)}+` } }],
    ['no browser name', { browser: '' }],
    ['a browser name over 100 characters', { browser: 'x'.repeat(101) }],
  ])('refuses %s, keeping nothing', async (_what, wrong) => {
    const turned = await turnOn()({ caller: CALLER, fleetName: 'Acme', ...FIREFOX, ...wrong });

    expect({ kind: !turned.isOk && turned.error.kind, held: subscriptions.held }).toEqual({ kind: 'INVALID_SUBSCRIPTION', held: [] });
  });

  it.each([
    ['a private address', 'https://10.0.0.7/push'],
    ['a loopback address', 'https://127.0.0.1/push'],
    ['a link-local address', 'https://169.254.169.254/latest'],
    ['an IPv6 loopback address', 'https://[::1]/push'],
    ['a name that resolves to a private address', 'https://inside.example/push'],
    ['a name that resolves to a public and a private address', 'https://mixed.example/push'],
    ['a name that resolves to a link-local address', 'https://metadata.example/push'],
    ['a name that resolves to nothing', 'https://nowhere.example/push'],
  ])('refuses an endpoint at %s, keeping nothing: the gateway reaches push services at public addresses only', async (_what, endpoint) => {
    const turned = await turnOn()({ caller: CALLER, fleetName: 'Acme', ...FIREFOX, endpoint });

    expect({ kind: !turned.isOk && turned.error.kind, held: subscriptions.held }).toEqual({ kind: 'INVALID_SUBSCRIPTION', held: [] });
  });

  it('takes an endpoint of exactly 2048 characters and a browser name of 100', async () => {
    const turned = await turnOn()({ caller: CALLER, fleetName: 'Acme', ...FIREFOX, endpoint: `https://push.example/${'a'.repeat(2027)}`, browser: 'x'.repeat(100) });

    expect(turned.isOk).toBe(true);
  });

  it('is refused where the gateway holds no push keys, keeping nothing', async () => {
    const turned = await turnOn({ isWebPushOffered: false })({ caller: CALLER, fleetName: 'Acme', ...FIREFOX });

    expect({ kind: !turned.isOk && turned.error.kind, held: subscriptions.held }).toEqual({ kind: 'CHANNEL_NOT_OFFERED', held: [] });
  });

  it('is refused without a person ship', async () => {
    const turned = await turnOn()({ caller: { fleetId: FLEET_ID, grantId: 'grant-of-argo' }, fleetName: 'Acme', ...FIREFOX });

    expect(!turned.isOk && turned.error.kind).toBe('NOT_A_PERSON');
  });
});

describe('a person removes a browser', () => {
  it('forgets it, so it takes no wake again', async () => {
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/firefox' }));
    await subscriptions.save(aWebPushSubscription({ endpoint: 'https://push.example/chrome' }));

    await createTurnOffWebPush({ crewPersonShip: fakeCrewPersonShip(crews), subscriptions })({ caller: CALLER, endpoint: 'https://push.example/firefox' });

    expect(subscriptions.held.map(({ endpoint }) => endpoint)).toEqual(['https://push.example/chrome']);
  });
});
