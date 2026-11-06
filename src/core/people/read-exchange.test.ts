import { beforeEach, describe, expect, it } from 'vitest';

import { CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryPersonCrews, type ExchangeFixture } from '../../../test/support/people-fakes.js';
import type { ExchangeMessage } from './ports.js';
import { createReadExchange } from './read-exchange.js';

// A person's client shows what their person ship and one other ship said to
// each other as a chat: both ways, whole, newest first, 20 a page, older,
// newer or around one message. Core answers it; the gateway keeps no copy
// and reading acknowledges nothing.

const TRACKER = 'shp_01m3tbfspe96yf1rnr4ank9trk';
const OTHER = 'shp_01m3tbfspe96yf1rnr4ank9oth';
const CHARLOTTE = 'shp_01m3tbfspe96yf1rnr4ank0per';

function suffix(n: number): string {
  return String(n).padStart(4, '0');
}

/** The nth message of the exchange with the tracker: odd ones from the tracker, even ones the person's own. */
function aMessage(n: number, overrides: Partial<ExchangeMessage> = {}): ExchangeFixture['messages'][number] {
  const own = n % 2 === 0;
  return {
    deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${suffix(n)}`,
    messageId: `msg_01m3tbfspe96yf1rnr4ank${suffix(n)}`,
    otherShipId: TRACKER,
    senderShipId: own ? CHARLOTTE : TRACKER,
    payload: `Message ${String(n)}`,
    isPayloadUnreadable: false,
    contentType: 'text/plain',
    inReplyTo: null,
    sentAt: '2026-11-06T10:00:00.000Z',
    deliveryState: own ? 'acknowledged' : null,
    ...overrides,
  };
}

const MANY = Array.from({ length: 45 }, (_, index) => aMessage(index + 1));

let crews: ReturnType<typeof memoryPersonCrews>;

beforeEach(() => {
  crews = memoryPersonCrews();
});

function reading(messages: ExchangeFixture['messages']) {
  const fleet = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [], exchanges: { summaries: [], messages } });
  return { ...fleet, readExchange: createReadExchange({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: fleet.door }) };
}

function numbersOf(page: { isOk: boolean; value?: { items: readonly { payload: string }[] } }): number[] {
  return (page.value?.items ?? []).map(({ payload }) => Number(payload.replace('Message ', '')));
}

describe('a person reads their exchange with one other ship', () => {
  it('shows the newest 20 messages, both ways, whole, newest first', async () => {
    const { readExchange } = reading(MANY);

    const page = await readExchange({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, start: { kind: 'newest' } });

    expect(numbersOf(page)).toEqual([45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26]);
    expect(page).toMatchObject({ isOk: true, value: { olderCursor: 'dlv_01m3tbfspe96yf1rnr4ank0026', newerCursor: null } });
    expect(page.isOk && page.value.items.slice(0, 2)).toEqual([
      { messageId: 'msg_01m3tbfspe96yf1rnr4ank0045', senderShipId: TRACKER, payload: 'Message 45', isPayloadUnreadable: false, contentType: 'text/plain', inReplyTo: null, sentAt: '2026-11-06T10:00:00.000Z', deliveryState: null },
      { messageId: 'msg_01m3tbfspe96yf1rnr4ank0044', senderShipId: CHARLOTTE, payload: 'Message 44', isPayloadUnreadable: false, contentType: 'text/plain', inReplyTo: null, sentAt: '2026-11-06T10:00:00.000Z', deliveryState: 'acknowledged' },
    ]);
  });

  it('pages to the older messages from the cursor, and back to the newer ones', async () => {
    const { readExchange } = reading(MANY);

    const older = await readExchange({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, start: { kind: 'before', cursor: 'dlv_01m3tbfspe96yf1rnr4ank0026' } });
    expect(numbersOf(older)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);

    const newer = await readExchange({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, start: { kind: 'after', cursor: 'dlv_01m3tbfspe96yf1rnr4ank0025' } });
    expect(numbersOf(newer)).toEqual([45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26]);
  });

  it('opens the page around one message, with the newer and the older around it', async () => {
    const { readExchange } = reading(MANY);

    const page = await readExchange({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, start: { kind: 'around', messageId: 'msg_01m3tbfspe96yf1rnr4ank0020' } });

    expect(numbersOf(page)).toEqual([30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11]);
    expect(page).toMatchObject({ isOk: true, value: { olderCursor: 'dlv_01m3tbfspe96yf1rnr4ank0011', newerCursor: 'dlv_01m3tbfspe96yf1rnr4ank0030' } });
  });

  it('shows a short exchange whole with no cursors', async () => {
    const { readExchange } = reading([aMessage(1), aMessage(2)]);

    await expect(readExchange({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, start: { kind: 'newest' } })).resolves.toMatchObject({ isOk: true, value: { olderCursor: null, newerCursor: null } });
  });

  it('shows a payload the fleet cannot unseal now as unreadable, and the page still answers', async () => {
    const { readExchange } = reading([aMessage(1), aMessage(2, { payload: '', isPayloadUnreadable: true })]);

    const page = await readExchange({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, start: { kind: 'newest' } });

    expect(page.isOk && page.value.items.map(({ payload, isPayloadUnreadable }) => ({ payload, isPayloadUnreadable }))).toEqual([
      { payload: '', isPayloadUnreadable: true },
      { payload: 'Message 1', isPayloadUnreadable: false },
    ]);
  });

  it('asks the fleet for the exchange only, and acknowledges and keeps nothing', async () => {
    const { readExchange, calls } = reading(MANY);

    await readExchange({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, start: { kind: 'newest' } });

    expect(calls.filter((call) => !call.startsWith('whoami'))).toEqual([`exchange(${TRACKER}, newest)`]);
  });

  it('refuses a ship that is not in the fleet', async () => {
    const { readExchange } = reading(MANY);

    await expect(readExchange({ caller: CHARLOTTE_GRANT, otherShipId: OTHER, start: { kind: 'newest' } })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_SHIP' } });
  });

  it('refuses a message that is not in the exchange', async () => {
    const { readExchange } = reading(MANY);

    await expect(readExchange({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, start: { kind: 'around', messageId: 'msg_01m3tbfspe96yf1rnr4ank0zzz' } })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_MESSAGE' } });
  });

  it('says the exchange cannot be read when the fleet does not answer, and loses nothing', async () => {
    const { readExchange, refusals } = reading(MANY);
    refusals.exchange.push({ code: 'INTERNAL', message: 'The fleet is busy' });

    await expect(readExchange({ caller: CHARLOTTE_GRANT, otherShipId: TRACKER, start: { kind: 'newest' } })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
