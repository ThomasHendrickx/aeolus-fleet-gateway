import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryMeetingContributions } from '../../../test/support/meeting-contributions-fake.js';
import { aMeetingRead, HEADS_MEETING_ID, fakePersonMeetingDoor } from '../../../test/support/meeting-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryInboxChanges, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createRecordingMeetingDoor } from './recording-meeting-door.js';
import { createReadMeeting } from './read-meeting.js';
import { createReadUnseenContributions } from './read-unseen-contributions.js';

const ship = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
const message = { messageId: 'msg_01m5qa5j85mgd4z61d9c2k0001', sentAt: new Date('2026-10-24T09:01:00.000Z') } as const;

function setup() {
  const contributions = memoryMeetingContributions();
  const crews = memoryPersonCrews();
  const crewPersonShip = fakeCrewPersonShip(crews);
  const read = createReadUnseenContributions({ contributions, crewPersonShip });
  return { contributions, crews, crewPersonShip, read };
}

describe('unseen contributions per meeting in the person record', () => {
  it('counts the requested meetings without reading deliveries or the meeting history', async () => {
    const { contributions, read } = setup();
    await contributions.note(ship, { contributions: [{ ...message, meetingId: HEADS_MEETING_ID }], isSeen: false });
    await expect(read({ caller: CHARLOTTE_GRANT, meetingIds: [HEADS_MEETING_ID, 'mtg_01m5qa5j85mgd4z61d9c2k0002'] })).resolves.toEqual({ isOk: true, value: [{ meetingId: HEADS_MEETING_ID, count: 1 }, { meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k0002', count: 0 }] });
  });

  it('records each received contribution before exposing it and ignores meeting notices', async () => {
    const { contributions, read } = setup();
    const fleet = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [aPersonDelivery({ meetingId: HEADS_MEETING_ID, contentType: 'text/plain' }), aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', meetingId: HEADS_MEETING_ID, contentType: 'application/vnd.aeolus.meeting.mic+json' })] });
    const door = createRecordingMeetingDoor(fleet.door, contributions);
    await door.pushReceive('aeolus_ct_v1_charlotte', { max: 10 });
    await door.pushReceive('aeolus_ct_v1_charlotte', { max: 10 });
    await expect(read({ caller: CHARLOTTE_GRANT, meetingIds: [HEADS_MEETING_ID] })).resolves.toEqual({ isOk: true, value: [{ meetingId: HEADS_MEETING_ID, count: 1 }] });
  });

  it('marks only the page shown in the meeting seen for every device, even before its delivery arrives', async () => {
    const { contributions, crews, crewPersonShip } = setup();
    const meeting = aMeetingRead();
    const older = { ...message, messageId: 'msg_01m5qa5j85mgd4z61d9c2k0002' } as const;
    await contributions.note(ship, { contributions: [{ ...older, meetingId: HEADS_MEETING_ID }], isSeen: false });
    const door = fakePersonMeetingDoor({ crewToken: 'aeolus_ct_v1_charlotte', meetings: [meeting] }).door;
    const readMeeting = createReadMeeting({ crews, crewPersonShip, door, contributions, changes: memoryInboxChanges() });
    await readMeeting({ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID });
    await contributions.note(ship, { contributions: [{ ...message, meetingId: HEADS_MEETING_ID }], isSeen: false });
    await expect(createReadUnseenContributions({ contributions, crewPersonShip: fakeCrewPersonShip(crews) })({ caller: CHARLOTTE_GRANT, meetingIds: [HEADS_MEETING_ID] })).resolves.toEqual({ isOk: true, value: [{ meetingId: HEADS_MEETING_ID, count: 1 }] });
  });

  it('refuses a caller without a person ship', async () => {
    await expect(setup().read({ caller: { fleetId: FLEET_ID, grantId: 'unknown' }, meetingIds: [HEADS_MEETING_ID] })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
  });
});
