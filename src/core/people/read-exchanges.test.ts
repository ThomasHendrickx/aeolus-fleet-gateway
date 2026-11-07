import { beforeEach, describe, expect, it } from 'vitest';

import { CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import type { ExchangeSummary } from './ports.js';
import { createReadExchanges } from './read-exchanges.js';

// Home lists the latest exchange per other ship, 20 a page, with how many of
// its messages are not yet seen, from core's rollup, never every message not
// done. Reading marks nothing.

function anExchange(n: number, overrides: Partial<ExchangeSummary> = {}): ExchangeSummary {
  const suffix = String(n).padStart(4, '0');
  return {
    otherShipId: `shp_01m3tbfspe96yf1rnr4ank${suffix}`,
    otherShipName: `ship-${String(n)}`,
    otherShipType: 'tracker',
    otherShipKind: 'agent',
    unacknowledged: n % 3,
    newestMessage: { messageId: `msg_01m3tbfspe96yf1rnr4ank${suffix}`, senderShipId: `shp_01m3tbfspe96yf1rnr4ank${suffix}`, payload: `Latest of ${String(n)}`, isPayloadUnreadable: false, contentType: 'text/plain', sentAt: '2026-11-06T10:00:00.000Z' },
    ...overrides,
  };
}

let crews: ReturnType<typeof memoryPersonCrews>;

beforeEach(() => {
  crews = memoryPersonCrews();
});

function reading(summaries: ExchangeSummary[]) {
  const fleet = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [], exchanges: { summaries, messages: [] } });
  return { ...fleet, readExchanges: createReadExchanges({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: fleet.door }) };
}

describe('a person lists their exchanges', () => {
  it('lists the latest exchange per other ship, newest first, 20 a page, with how many are not yet seen', async () => {
    const { readExchanges } = reading(Array.from({ length: 25 }, (_, index) => anExchange(index + 1)));

    const page = await readExchanges({ caller: CHARLOTTE_GRANT, cursor: null });

    expect(page.isOk && page.value.items).toHaveLength(20);
    expect(page.isOk && page.value.items[0]).toEqual(anExchange(25));
    expect(page.isOk && page.value.items[0]?.unacknowledged).toBe(1);
    expect(page).toMatchObject({ isOk: true, value: { nextCursor: 'msg_01m3tbfspe96yf1rnr4ank0006' } });
  });

  it('pages on from the cursor to the last page, which has no next', async () => {
    const { readExchanges } = reading(Array.from({ length: 25 }, (_, index) => anExchange(index + 1)));

    const page = await readExchanges({ caller: CHARLOTTE_GRANT, cursor: 'msg_01m3tbfspe96yf1rnr4ank0006' });

    expect(page.isOk && page.value.items.map(({ otherShipName }) => otherShipName)).toEqual(['ship-5', 'ship-4', 'ship-3', 'ship-2', 'ship-1']);
    expect(page).toMatchObject({ isOk: true, value: { nextCursor: null } });
  });

  it('shows no exchanges for a person ship that talked with nobody', async () => {
    const { readExchanges } = reading([]);

    await expect(readExchanges({ caller: CHARLOTTE_GRANT, cursor: null })).resolves.toEqual({ isOk: true, value: { items: [], nextCursor: null } });
  });

  it('leaves a payload the fleet cannot unseal now marked unreadable, and the list still answers', async () => {
    const { readExchanges } = reading([anExchange(1, { newestMessage: { ...anExchange(1).newestMessage, payload: '', isPayloadUnreadable: true } })]);

    const page = await readExchanges({ caller: CHARLOTTE_GRANT, cursor: null });

    expect(page.isOk && page.value.items[0]?.newestMessage).toMatchObject({ payload: '', isPayloadUnreadable: true });
  });

  it('asks the fleet for the list only, and acknowledges and keeps nothing', async () => {
    const { readExchanges, calls } = reading([anExchange(1)]);

    await readExchanges({ caller: CHARLOTTE_GRANT, cursor: null });

    expect(calls.filter((call) => !call.startsWith('whoami'))).toEqual(['exchanges(newest)']);
  });

  it('says the list cannot be read when the fleet does not answer', async () => {
    const { readExchanges, refusals } = reading([anExchange(1)]);
    refusals.exchanges.push({ code: 'INTERNAL', message: 'The fleet is busy' });

    await expect(readExchanges({ caller: CHARLOTTE_GRANT, cursor: null })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
