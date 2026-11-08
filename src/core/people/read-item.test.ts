import { QUESTION_CONTENT_TYPE } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { CHARLOTTE_GRANT, aBasketEntry, aPersonDelivery, fakeCrewPersonShip, fakePersonShipDoor, holding, memoryBasketEntries, memoryOpenedDeliveries, memoryPersonCrews, memoryRoutes } from '../../../test/support/people-fakes.js';
import type { PersonDelivery, RecordedPersonDelivery } from './ports.js';
import { createReadItem } from './read-item.js';
import { ITEM_JOBS, routingDefaultsOf, type Route } from './routing.js';

// A person's client shows one item whole by its delivery id, in any state,
// without acknowledging it: what opening returns, minus the acknowledging,
// with its message, the places that show it and its answer in the basket.

const WAITING = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', contentType: 'text/plain', payload: 'The build is red', headline: null });
const DONE: RecordedPersonDelivery = { ...aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', messageId: 'msg_01m3tbfspe96yf1rnr4ank0001', contentType: 'text/plain', payload: 'Release 1.4 is out', headline: null }), state: 'handled', isPayloadUnreadable: false };

const QUESTION_ID = '5d1c3f0e-7a2b-4c9d-8e6f-1a2b3c4d5e6f';
const QUESTION = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify({ id: QUESTION_ID, title: 'Harbour first?', context: '', options: [{ key: 1, label: 'Yes' }] }), headline: 'Harbour first?', askedQuestionId: QUESTION_ID });

let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let entries: ReturnType<typeof memoryBasketEntries>;

beforeEach(() => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
  entries = memoryBasketEntries();
});

/** The gateway's defaults (CC19): a chat on for every job. */
const CHAT_ON = routingDefaultsOf(ITEM_JOBS.map((job) => ({ job, place: 'chat' as const })));

function reading(ship: { deliveries?: PersonDelivery[]; acknowledged?: PersonDelivery[]; record?: RecordedPersonDelivery[]; routes?: Route[] }) {
  const { routes = [], ...onBoard } = ship;
  const fleet = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [], ...onBoard });
  return {
    ...fleet,
    readItem: createReadItem({ crewPersonShip: fakeCrewPersonShip(crews), crews, ...holding(fleet.door), opened, entries, connections: memoryConnectionStore(), routes: memoryRoutes(routes), defaults: CHAT_ON, isEmailOffered: false, isWebPushOffered: false }),
  };
}

describe('a person reads one item whole', () => {
  it('shows a waiting item whole, with its payload and content type, and leaves it unacknowledged', async () => {
    const { readItem, calls } = reading({ deliveries: [WAITING] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: WAITING.deliveryId })).resolves.toEqual({
      isOk: true,
      value: { deliveryId: WAITING.deliveryId, from: 'tracker', fromShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk', title: 'The build is red', sentAt: '2026-10-19T08:00:00.000Z', contentType: 'text/plain', payload: 'The build is red', meetingId: null, said: null, stale: null, messageId: WAITING.messageId, places: ['chat'], inBasket: null },
    });
    expect(calls.some((call) => call.startsWith('ack('))).toBe(false);
    expect(opened.held.size).toBe(0);
  });

  it('shows an item the person acknowledged and is not done with, read again from the fleet', async () => {
    const { readItem } = reading({ acknowledged: [WAITING] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: WAITING.deliveryId })).resolves.toMatchObject({ isOk: true, value: { payload: 'The build is red', contentType: 'text/plain' } });
  });

  it('shows a done item whole from the ship\'s record, changing nothing', async () => {
    const { readItem, calls } = reading({ record: [DONE] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: DONE.deliveryId })).resolves.toEqual({
      isOk: true,
      value: { deliveryId: DONE.deliveryId, from: 'tracker', fromShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk', title: 'Release 1.4 is out', sentAt: '2026-10-19T08:00:00.000Z', contentType: 'text/plain', payload: 'Release 1.4 is out', meetingId: null, said: null, stale: null, messageId: DONE.messageId, places: ['chat'], inBasket: null },
    });
    expect(calls.some((call) => call.startsWith('ack(') || call.startsWith('handled('))).toBe(false);
    expect(opened.held.size).toBe(0);
  });

  it('finds a done item on an older page of the record', async () => {
    const newer = Array.from({ length: 25 }, (_, index): RecordedPersonDelivery => ({ ...DONE, deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${String(index + 10).padStart(4, '0')}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${String(index + 10).padStart(4, '0')}` }));
    const { readItem } = reading({ record: [DONE, ...newer] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: DONE.deliveryId })).resolves.toMatchObject({ isOk: true, value: { payload: 'Release 1.4 is out' } });
  });

  it('refuses a delivery that is not the person ship\'s own', async () => {
    const { readItem } = reading({ deliveries: [WAITING], record: [DONE] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0zzz' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
  });

  it('refuses a done item whose payload the fleet cannot unseal now', async () => {
    const { readItem } = reading({ record: [{ ...DONE, payload: '', isPayloadUnreadable: true }] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: DONE.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'KEY_UNAVAILABLE' } });
  });

  it('names the message of an item acknowledged and not done, so the client reads the exchange around it', async () => {
    const { readItem } = reading({ acknowledged: [WAITING] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: WAITING.deliveryId })).resolves.toMatchObject({ isOk: true, value: { messageId: WAITING.messageId } });
  });

  it('names the places besides Bridge that show the item, as routing per job has them', async () => {
    const routes: Route[] = [{ fleetId: CHARLOTTE_GRANT.fleetId, shipId: PERSON_SHIP_ID, job: 'decide', place: 'slack', isOn: true, changedAt: new Date('2026-10-01T00:00:00.000Z') }];
    const { readItem } = reading({ deliveries: [QUESTION], routes });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: true, value: { places: ['slack', 'chat'] } });
  });

  it('shows the answer to a question as it waits in the basket, the option and the note', async () => {
    await entries.save(aBasketEntry({ questionId: QUESTION_ID, deliveryId: QUESTION.deliveryId, option: 2, note: 'Harbour first' }));
    const { readItem } = reading({ deliveries: [QUESTION] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: true, value: { inBasket: { option: 2, note: 'Harbour first' } } });
  });

  it('shows no basket entry for a question whose answer the basket does not hold', async () => {
    await entries.save(aBasketEntry({ questionId: 'a-question-of-another-delivery', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0zzz' }));
    const { readItem } = reading({ deliveries: [QUESTION] });

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: true, value: { inBasket: null } });
  });

  it('reads the basket by the item\'s question alone, never the whole of it', async () => {
    const { readItem } = reading({ deliveries: [QUESTION] });
    entries.list = () => Promise.reject(new Error('The whole basket was read'));

    await expect(readItem({ caller: CHARLOTTE_GRANT, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: true });
  });
});
