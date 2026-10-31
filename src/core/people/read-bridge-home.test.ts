import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { createReadBridgeHome } from './read-bridge-home.js';

// Bridge home (docs/design/bridge, CC18): what waits on the person with one
// count, decide and do, and the stay-aware feed beside it, outside the count.

let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;

beforeEach(() => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
});

function readHome(deliveries: PersonDelivery[]) {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries });
  return { ...ship, readHome: createReadBridgeHome({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, opened }) };
}

const QUESTION = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', sentAt: new Date('2026-10-31T19:48:00.000Z'), senderName: 'orchestrator-1', headline: 'Which goes first: the Compact look (U4) or Harbour?' });
const STEP = aPersonDelivery({
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002',
  sentAt: new Date('2026-10-31T19:00:00.000Z'),
  senderName: 'orchestrator-1',
  contentType: 'application/vnd.aeolus.step+json',
  payload: '{"id":"6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10","title":"Create the GitHub repository aeolus-fleet-memory-plugin","why":""}',
  headline: 'Create the GitHub repository aeolus-fleet-memory-plugin',
});
const ALERT = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', sentAt: new Date('2026-10-31T19:54:00.000Z'), senderName: 'watch', contentType: 'application/vnd.aeolus.alert+json', payload: '{}', headline: 'builder-gateway: no report change for 2 h' });
const NOTICE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0004', sentAt: new Date('2026-10-31T19:51:00.000Z'), senderName: 'design-command-center', contentType: 'application/vnd.aeolus.notice+json', payload: '{}', headline: 'PR #1497 opened: Bridge mockups' });
const TEXT = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0005', contentType: 'text/plain', payload: 'Thanks', headline: null });

/** A question from commercial that Charlotte opened in Bridge and has not answered. */
function anOpened(overrides: Partial<OpenedDelivery> = {}): OpenedDelivery {
  return {
    fleetId: FLEET_ID,
    shipId: PERSON_SHIP_ID,
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0009',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0009',
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9com',
    from: 'commercial',
    title: 'Pricing page: a price per ship, or plans only?',
    contentType: 'application/vnd.aeolus.question+json',
    sentAt: new Date('2026-10-31T19:20:00.000Z'),
    openedAt: new Date('2026-10-31T19:30:00.000Z'),
    ...overrides,
  };
}

describe('Bridge home: what waits on the person, with one count (CC18)', () => {
  it('lists the questions and steps that wait, newest first, and counts them', async () => {
    const home = await readHome([STEP, QUESTION]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { count: home.value.waiting.count, items: home.value.waiting.items.map(({ title, job, state }) => ({ title, job, state })) } : home).toEqual({
      count: 2,
      items: [
        { title: 'Which goes first: the Compact look (U4) or Harbour?', job: 'decide', state: 'new' },
        { title: 'Create the GitHub repository aeolus-fleet-memory-plugin', job: 'do', state: 'new' },
      ],
    });
  });

  it('lists a question the person opened and has not answered as seen, still in the count', async () => {
    await opened.save(anOpened());

    const home = await readHome([QUESTION]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { count: home.value.waiting.count, items: home.value.waiting.items.map(({ from, state }) => ({ from, state })) } : home).toEqual({
      count: 2,
      items: [
        { from: 'orchestrator-1', state: 'new' },
        { from: 'commercial', state: 'seen' },
      ],
    });
  });

  it('counts a delivery opened before Bridge, whose content type the gateway did not keep, as one to decide: it waited then', async () => {
    await opened.save(anOpened({ contentType: null }));

    const home = await readHome([]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.waiting.items.map(({ job }) => job) : home).toEqual(['decide']);
  });

  it('leaves an opened message that is neither a question nor a step out of what waits', async () => {
    await opened.save(anOpened({ contentType: 'text/plain' }));

    const home = await readHome([]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.waiting : home).toEqual({ count: 0, items: [] });
  });

  it('puts the alerts and notices that reached the person in the stay-aware feed, newest first, outside the count', async () => {
    const home = await readHome([NOTICE, QUESTION, ALERT]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { count: home.value.waiting.count, stayAware: home.value.stayAware.map(({ title, from }) => ({ title, from })) } : home).toEqual({
      count: 1,
      stayAware: [
        { title: 'builder-gateway: no report change for 2 h', from: 'watch' },
        { title: 'PR #1497 opened: Bridge mockups', from: 'design-command-center' },
      ],
    });
  });

  it('leaves everything else out of what waits and the feed: it is in the record', async () => {
    const home = await readHome([TEXT]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { waiting: home.value.waiting, stayAware: home.value.stayAware } : home).toEqual({ waiting: { count: 0, items: [] }, stayAware: [] });
  });

  it('takes nothing from the fleet while nothing waits there', async () => {
    const reading = readHome([]);

    await reading.readHome(CHARLOTTE_GRANT);

    expect(reading.calls).toEqual(['inbox']);
  });

  it('says the fleet did not answer when it cannot read what waits', async () => {
    const reading = readHome([QUESTION]);
    reading.refusals.pushReceive.push({ code: 'FLEET_UNREACHABLE', message: 'The fleet did not answer' });

    await expect(reading.readHome(CHARLOTTE_GRANT)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
