import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryMeetingContributions } from '../../../test/support/meeting-contributions-fake.js';
import { HEADS_MEETING_ID } from '../../../test/support/meeting-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createReadUnseenMeetings } from './read-unseen-meetings.js';

function setup() {
  const contributions = memoryMeetingContributions();
  const crewPersonShip = fakeCrewPersonShip(memoryPersonCrews());
  return { contributions, read: createReadUnseenMeetings({ contributions, crewPersonShip }) };
}

describe('the person reads meetings with something new', () => {
  it("returns meetings and counts from the caller's own contribution record", async () => {
    const { contributions, read } = setup();
    const contribution = { meetingId: HEADS_MEETING_ID, messageId: 'msg_01m5qa5j85mgd4z61d9c2k0001', sentAt: new Date('2099-01-01T00:00:00Z') } as const;
    await contributions.note({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }, { contributions: [contribution], isSeen: false });
    await expect(read(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: [{ meetingId: HEADS_MEETING_ID, count: 1 }] });
  });

  it('returns an empty page when nothing is new', async () => {
    await expect(setup().read(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: [] });
  });

  it('refuses a caller without a person ship', async () => {
    await expect(setup().read({ fleetId: FLEET_ID, grantId: 'unknown' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
  });
});
