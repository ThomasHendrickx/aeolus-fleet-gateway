import { describe, expect, it } from 'vitest';

import { aBasketEntry, CHARLOTTE_GRANT, fakeCrewPersonShip, memoryBasketEntries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { createCountBasket } from './count-basket.js';

// Bridge's navigation shows the basket with its count while it holds any
// (section 9, rule 2): a count from the gateway's database, nothing read
// from the fleet, as every page shows it.

describe("the basket's count", () => {
  it('counts what is or will be sent: entries waiting and sending, and the sent ones while any is still sending; not one refused', async () => {
    const entries = memoryBasketEntries();
    await entries.save(aBasketEntry());
    await entries.save(aBasketEntry({ questionId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', state: 'sending' }));
    await entries.save(aBasketEntry({ questionId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', state: 'refused', refusal: 'retired' }));
    await entries.save(aBasketEntry({ questionId: '1b2c3d4e-5f6a-4b7c-8d8e-9f0a1b2c3d4e', state: 'refused', refusal: 'retired' }));
    await entries.save(aBasketEntry({ questionId: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d', state: 'sent', storedAt: new Date('2026-10-31T20:16:00.000Z') }));
    await entries.save(aBasketEntry({ fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8zz' }));

    const counted = await createCountBasket({ crewPersonShip: fakeCrewPersonShip(memoryPersonCrews()), entries })(CHARLOTTE_GRANT);

    expect(counted).toEqual({ isOk: true, value: { count: 3 } });
  });

  it('counts no sent entry once none is still sending', async () => {
    const entries = memoryBasketEntries();
    await entries.save(aBasketEntry({ state: 'sent', storedAt: new Date('2026-10-31T20:16:00.000Z') }));

    const counted = await createCountBasket({ crewPersonShip: fakeCrewPersonShip(memoryPersonCrews()), entries })(CHARLOTTE_GRANT);

    expect(counted).toEqual({ isOk: true, value: { count: 0 } });
  });
});
