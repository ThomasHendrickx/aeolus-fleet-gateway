import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { fakePersonShipFleet, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { err, ok } from '../shared/result.js';
import type { AccountTokenOf } from '../sign-in/account-token.js';
import { createCrewPersonShip } from './crew-person-ship.js';

// The gateway crews a signed-in person's person ship for their messaging
// (decisions 0054, 0057): as the account, with its token beside the
// gateway's crew token, it gets the ship's starting prompt and registers, and
// every client of that person shares the one crew.

const AT = new Date('2026-10-19T09:00:00.000Z');
const GRANT = { fleetId: FLEET_ID, grantId: 'grant-1' };

let connections: ReturnType<typeof memoryConnectionStore>;
let crews: ReturnType<typeof memoryPersonCrews>;
let accountTokenOf: AccountTokenOf;

beforeEach(async () => {
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  crews = memoryPersonCrews();
  accountTokenOf = () => Promise.resolve(ok({ accountToken: 'account-token-1', accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID, scopes: [] }));
});

function crewPersonShip(fleet = fakePersonShipFleet({ personShipId: PERSON_SHIP_ID })) {
  return { fleet, crewPersonShip: createCrewPersonShip({ accountTokenOf: (grant) => accountTokenOf(grant), connections, door: fleet.door, crews, clock: { now: () => AT } }) };
}

describe("a signed-in person's person ship", () => {
  it('is crewed by the gateway as the account: its starting prompt, then a register with its secret', async () => {
    const { fleet, crewPersonShip: crew } = crewPersonShip();

    await expect(crew(GRANT)).resolves.toEqual({ isOk: true, value: { shipId: PERSON_SHIP_ID, crewToken: 'aeolus_ct_v1_person_1' } });
    expect(fleet.state.calls).toEqual([`startingPrompt ${PERSON_SHIP_ID}`, `register ${PERSON_SHIP_ID}`]);
  });

  it('keeps its crew token for every client of the person: the next call asks the fleet nothing', async () => {
    const { fleet, crewPersonShip: crew } = crewPersonShip();
    await crew(GRANT);

    await expect(crew({ fleetId: FLEET_ID, grantId: 'grant-2' })).resolves.toMatchObject({ isOk: true, value: { crewToken: 'aeolus_ct_v1_person_1' } });
    expect({ calls: fleet.state.calls.length, crews: crews.held }).toEqual({ calls: 2, crews: [{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: 'aeolus_ct_v1_person_1', crewedAt: AT }] });
  });

  it('is crewed once for calls made together: one lease (decision 0010)', async () => {
    const { fleet, crewPersonShip: crew } = crewPersonShip();

    const answers = await Promise.all([crew(GRANT), crew(GRANT), crew({ fleetId: FLEET_ID, grantId: 'grant-2' })]);

    expect({ registers: fleet.state.calls.filter((call) => call.startsWith('register')).length, tokens: answers.map((answer) => (answer.isOk ? answer.value.crewToken : answer.error.kind)) }).toEqual({
      registers: 1,
      tokens: ['aeolus_ct_v1_person_1', 'aeolus_ct_v1_person_1', 'aeolus_ct_v1_person_1'],
    });
  });

  it('is released as the account first when a crew the gateway does not hold has it, then crewed', async () => {
    const { fleet, crewPersonShip: crew } = crewPersonShip(fakePersonShipFleet({ personShipId: PERSON_SHIP_ID, isCrewedElsewhere: true }));

    await expect(crew(GRANT)).resolves.toMatchObject({ isOk: true, value: { crewToken: 'aeolus_ct_v1_person_1' } });
    expect(fleet.state.calls).toEqual([`startingPrompt ${PERSON_SHIP_ID}`, `release ${PERSON_SHIP_ID}`, `startingPrompt ${PERSON_SHIP_ID}`, `register ${PERSON_SHIP_ID}`]);
  });

  it('is none for an account with no person ship: it may not message there (decision 0052)', async () => {
    accountTokenOf = () => Promise.resolve(ok({ accountToken: 'account-token-1', accountId: 'acc-charlotte', personShipId: null, scopes: [] }));
    const { fleet, crewPersonShip: crew } = crewPersonShip();

    await expect(crew(GRANT)).resolves.toEqual({ isOk: false, error: { kind: 'noPersonShip' } });
    expect(fleet.state.calls).toEqual([]);
  });

  it.each([
    ['signedOut', err({ kind: 'signedOut' as const })],
    ['pagasaeUnavailable', err({ kind: 'pagasaeUnavailable' as const })],
  ])("is none when there is no account token to call with: %s", async (kind, answer) => {
    accountTokenOf = () => Promise.resolve(answer);

    await expect(crewPersonShip().crewPersonShip(GRANT)).resolves.toEqual({ isOk: false, error: { kind } });
  });

  it('is none while the gateway is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(crewPersonShip().crewPersonShip(GRANT)).resolves.toEqual({ isOk: false, error: { kind: 'notConnected' } });
  });

  it("says the fleet's refusal, keeping no crew", async () => {
    accountTokenOf = () => Promise.resolve(ok({ accountToken: 'account-token-other', accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID, scopes: [] }));

    await expect(crewPersonShip().crewPersonShip(GRANT)).resolves.toEqual({ isOk: false, error: { kind: 'fleetRefused', message: 'is not your person ship' } });
    expect(crews.held).toEqual([]);
  });
});
