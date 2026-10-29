import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { HEADS_MEETING_ID, aMeetingRead, fakePersonMeetingDoor } from '../../../test/support/meeting-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { createChangeOwnMic } from './change-own-mic.js';

// A person's own mic calls in a meeting, as their person ship (decision
// 0061, M8, M10, M19): request it, withdraw the request, release the mic they
// hold. The fleet decides each, and says why when the meeting does not allow it.

let crews: ReturnType<typeof memoryPersonCrews>;

beforeEach(() => {
  crews = memoryPersonCrews();
});

function changing() {
  const fleet = fakePersonMeetingDoor({ crewToken: 'aeolus_ct_v1_charlotte', meetings: [aMeetingRead()] });
  const changeOwnMic = createChangeOwnMic({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: fleet.door });
  return { ...fleet, changeOwnMic };
}

describe("a person's own mic calls", () => {
  it.each(['request', 'withdraw', 'release'] as const)('makes the %s call on the meeting as their person ship', async (change) => {
    const { changeOwnMic, changes } = changing();

    const changed = await changeOwnMic({ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID, change });

    expect({ changed, changes }).toEqual({ changed: { isOk: true, value: undefined }, changes: [{ meetingId: HEADS_MEETING_ID, change }] });
  });

  it.each([
    ['they already requested it', 'You already requested the mic of this meeting'],
    ['they hold no mic to release', 'You do not hold the mic of this meeting'],
    ['the meeting ended', 'The meeting ended'],
  ])('tells the person why the fleet refused it when %s', async (_, reason) => {
    const { changeOwnMic, refusals } = changing();
    refusals.changeMic.push({ code: 'CONFLICT', message: reason });

    await expect(changeOwnMic({ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID, change: 'request' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'MIC_REFUSED', message: `The fleet did not change the mic: ${reason}` },
    });
  });

  it('refuses an account with no person ship, asking the fleet nothing', async () => {
    const { changeOwnMic, calls } = changing();

    await expect(changeOwnMic({ caller: { fleetId: FLEET_ID, grantId: 'grant-2' }, meetingId: HEADS_MEETING_ID, change: 'request' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(calls).toEqual([]);
  });
});
