import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE, CHIEF_OF_STAFF, HEAD_OF_MARKETING, HEADS_MEETING_ID, aMeetingRead, fakePersonMeetingDoor } from '../../../test/support/meeting-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { createReadMeeting } from './read-meeting.js';

// A person reads a meeting they take part in as their person ship (decision
// 0061, M19): the fleet's read, and where they stand on its mic, so the page
// and their agent know whether to contribute, request or release.

let crews: ReturnType<typeof memoryPersonCrews>;

beforeEach(() => {
  crews = memoryPersonCrews();
});

function reading(meetings = [aMeetingRead()]) {
  const fleet = fakePersonMeetingDoor({ crewToken: 'aeolus_ct_v1_charlotte', meetings });
  const readMeeting = createReadMeeting({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: fleet.door });
  return { ...fleet, readMeeting };
}

describe('a person reads a meeting they take part in', () => {
  it('reads it as the fleet answers it, with the newest contributions first', async () => {
    const { readMeeting } = reading();

    const read = await readMeeting({ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID });

    expect(read).toEqual({ isOk: true, value: { meeting: aMeetingRead(), mic: { kind: 'none' } } });
  });

  it('reads the page of older contributions after the cursor', async () => {
    const { readMeeting, calls } = reading();

    await readMeeting({ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID, cursor: 'msg_01m5qa5j85mgd4z61d9c2k0001' });

    expect(calls).toEqual([`meeting(${HEADS_MEETING_ID}, msg_01m5qa5j85mgd4z61d9c2k0001)`]);
  });

  it('says the person holds the mic', async () => {
    const { readMeeting } = reading([aMeetingRead({ mic: { holder: CHARLOTTE, pattern: 'fifo', requests: [] } })]);

    const read = await readMeeting({ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID });

    expect(read).toMatchObject({ isOk: true, value: { mic: { kind: 'holding' } } });
  });

  it('says the person moderates, so they contribute without the mic', async () => {
    const { readMeeting } = reading([aMeetingRead({ moderator: CHARLOTTE })]);

    const read = await readMeeting({ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID });

    expect(read).toMatchObject({ isOk: true, value: { mic: { kind: 'moderating' } } });
  });

  it('says the place in line of the request the person made, counted from 1', async () => {
    const requests = [
      { ship: HEAD_OF_MARKETING, requestedAt: new Date('2026-10-24T09:02:00.000Z') },
      { ship: CHARLOTTE, requestedAt: new Date('2026-10-24T09:03:00.000Z') },
    ];
    const { readMeeting } = reading([aMeetingRead({ mic: { holder: CHIEF_OF_STAFF, pattern: 'fifo', requests } })]);

    const read = await readMeeting({ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID });

    expect(read).toMatchObject({ isOk: true, value: { mic: { kind: 'requested', place: 2 } } });
  });

  it('tells the person why the fleet refused the read, as for a meeting they take no part in', async () => {
    const { readMeeting } = reading([]);

    await expect(readMeeting({ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NO_SUCH_MEETING', message: `The fleet did not read the meeting to you: Meeting ${HEADS_MEETING_ID} does not exist` },
    });
  });

  it('refuses an account with no person ship, asking the fleet nothing', async () => {
    const { readMeeting, calls } = reading();

    await expect(readMeeting({ caller: { fleetId: FLEET_ID, grantId: 'grant-2' }, meetingId: HEADS_MEETING_ID })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(calls).toEqual([]);
  });
});
