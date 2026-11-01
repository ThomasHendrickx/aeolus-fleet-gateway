import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aBasketEntry, aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryBasketEntries, memoryItemOutcomes, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { PersonDelivery } from './ports.js';
import { createReadBasket } from './read-basket.js';

// The basket open (Bridge, section 9, rule 2): each entry, the question, its
// asker, the option and the note, in the order added; withdrawn, replaced,
// answered elsewhere and refused entries say so, and are not sent.

const PRICING = aBasketEntry({
  questionId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0002',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9cqm',
  from: 'commercial',
  title: 'Pricing page: a price per ship, or plans only?',
  sentAt: new Date('2026-10-31T19:13:00.000Z'),
  option: 1,
  note: null,
  addedAt: new Date('2026-10-31T19:55:00.000Z'),
});
const RETENTION = aBasketEntry({
  questionId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0003',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9cqr',
  from: 'builder-core',
  title: 'Record retention for person ships: 90 days or 1 year?',
  sentAt: new Date('2026-10-31T19:28:00.000Z'),
  option: 1,
  note: 'A year only when a customer asks for it.',
  addedAt: new Date('2026-10-31T19:57:00.000Z'),
});

let entries: ReturnType<typeof memoryBasketEntries>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;

beforeEach(() => {
  entries = memoryBasketEntries();
  outcomes = memoryItemOutcomes();
});

function readBasketWith(deliveries: PersonDelivery[]) {
  const crews = memoryPersonCrews();
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries });
  return createReadBasket({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, opened: memoryOpenedDeliveries(), entries, outcomes });
}

describe('the basket open', () => {
  it('lists each entry in the order added, with its question, asker, option and note, and counts the answers to send', async () => {
    await entries.save(RETENTION);
    await entries.save(aBasketEntry());
    await entries.save(PRICING);

    const basket = await readBasketWith([])(CHARLOTTE_GRANT);

    expect(basket).toEqual({
      isOk: true,
      value: {
        toSend: 3,
        entries: [
          { questionId: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', from: 'orchestrator-1', title: 'Which goes first: the Compact look (U4) or Harbour?', sentAt: '2026-10-31T19:41:00.000Z', option: 2, note: 'Harbour first: the demo on 12 Nov needs it.', standing: { kind: 'waiting' } },
          { questionId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', from: 'commercial', title: 'Pricing page: a price per ship, or plans only?', sentAt: '2026-10-31T19:13:00.000Z', option: 1, note: null, standing: { kind: 'waiting' } },
          { questionId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', from: 'builder-core', title: 'Record retention for person ships: 90 days or 1 year?', sentAt: '2026-10-31T19:28:00.000Z', option: 1, note: 'A year only when a customer asks for it.', standing: { kind: 'waiting' } },
        ],
      },
    });
  });

  it('marks an entry withdrawn once its asker withdrew the question, outside the answers to send', async () => {
    await entries.save(aBasketEntry());
    await entries.save(RETENTION);
    const withdrawal = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0w01', senderShipId: aBasketEntry().senderShipId, contentType: 'application/vnd.aeolus.question-withdrawal+json', askedQuestionId: null, withdrawnQuestionId: aBasketEntry().questionId });

    const basket = await readBasketWith([withdrawal])(CHARLOTTE_GRANT);

    expect(basket).toMatchObject({ isOk: true, value: { toSend: 1, entries: [{ standing: { kind: 'withdrawn' } }, { standing: { kind: 'waiting' } }] } });
  });

  it('marks an entry replaced, linked to the replacement, a new question the answer is not carried to', async () => {
    await entries.save(PRICING);
    const replacement = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0r01', senderShipId: PRICING.senderShipId, contentType: 'application/vnd.aeolus.question-replacement+json', askedQuestionId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', withdrawnQuestionId: PRICING.questionId });

    const basket = await readBasketWith([replacement])(CHARLOTTE_GRANT);

    expect(basket).toMatchObject({ isOk: true, value: { toSend: 0, entries: [{ standing: { kind: 'replaced', replacementId: 'dlv_01m3tbfspe96yf1rnr4ank0r01' } }] } });
  });

  it('ignores a withdrawal from another ship than the asker', async () => {
    await entries.save(aBasketEntry());
    const withdrawal = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0w02', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9qth', contentType: 'application/vnd.aeolus.question-withdrawal+json', askedQuestionId: null, withdrawnQuestionId: aBasketEntry().questionId });

    const basket = await readBasketWith([withdrawal])(CHARLOTTE_GRANT);

    expect(basket).toMatchObject({ isOk: true, value: { toSend: 1, entries: [{ standing: { kind: 'waiting' } }] } });
  });

  it('marks an entry answered elsewhere when Slack or a chat answered its question first, with the option, outside the answers to send', async () => {
    await entries.save(aBasketEntry());
    await outcomes.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: aBasketEntry().deliveryId, place: 'slack', kind: 'answered', option: 3, at: new Date('2026-10-31T20:01:00.000Z') });

    const basket = await readBasketWith([])(CHARLOTTE_GRANT);

    expect(basket).toMatchObject({ isOk: true, value: { toSend: 0, entries: [{ standing: { kind: 'dealtElsewhere', place: 'slack', option: 3 } }] } });
  });

  it('shows an entry being sent as sending, and one the fleet refused with why, neither among the answers to send', async () => {
    await entries.save(aBasketEntry({ state: 'sending' }));
    await entries.save(PRICING);
    await entries.save(RETENTION);
    await entries.save({ ...PRICING, state: 'refused', refusal: 'commercial was retired, so it cannot receive an answer' });

    const basket = await readBasketWith([])(CHARLOTTE_GRANT);

    expect(basket).toMatchObject({
      isOk: true,
      value: { toSend: 1, entries: [{ standing: { kind: 'sending' } }, { standing: { kind: 'refused', reason: 'commercial was retired, so it cannot receive an answer' } }, { standing: { kind: 'waiting' } }] },
    });
  });

  it("lists none of another fleet's or another person ship's entries", async () => {
    await entries.save(aBasketEntry({ fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8zz' }));
    await entries.save(aBasketEntry({ shipId: 'shp_01m3tbfspe96yf1rnr4ank9dk1' }));

    await expect(readBasketWith([])(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { toSend: 0, entries: [] } });
  });
});
