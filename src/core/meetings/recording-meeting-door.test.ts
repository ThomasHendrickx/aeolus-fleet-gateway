import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryMeetingContributions } from '../../../test/support/meeting-contributions-fake.js';
import { HEADS_MEETING_ID } from '../../../test/support/meeting-fakes.js';
import { aPersonDelivery, fakePersonShipDoor, memoryInboxChanges } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { err } from '../shared/result.js';
import { createRecordingMeetingDoor } from './recording-meeting-door.js';

const CREW_TOKEN = 'aeolus_ct_v1_charlotte';
const SHIP = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };

function aContribution() {
  return aPersonDelivery({ meetingId: HEADS_MEETING_ID, contentType: 'text/plain' });
}

describe('recording meeting contributions on receipt', () => {
  it('acknowledges a contribution only after its person record is stored', async () => {
    const contributions = memoryMeetingContributions();
    const contribution = aContribution();
    const fleet = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries: [contribution] });
    const door = createRecordingMeetingDoor({
      ...fleet.door,
      ack: async (crewToken, deliveryId) => {
        expect(await contributions.unseen(SHIP, [HEADS_MEETING_ID])).toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
        return fleet.door.ack(crewToken, deliveryId);
      },
    }, { contributions, changes: memoryInboxChanges() });

    await door.pushReceive(CREW_TOKEN, { max: 10 });

    expect(await fleet.door.inbox(CREW_TOKEN)).toEqual({ isOk: true, value: { waiting: 0 } });
    expect(await fleet.door.delivery(CREW_TOKEN, contribution.deliveryId)).toEqual({ isOk: true, value: contribution });
  });

  it('redelivers after a failure between recording and acknowledgement without counting twice', async () => {
    const contributions = memoryMeetingContributions();
    const contribution = aContribution();
    const fleet = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries: [contribution] });
    const interrupted = createRecordingMeetingDoor(fleet.door, {
      contributions,
      changes: { tell: () => Promise.reject(new Error('Notification unavailable')) },
    });

    await expect(interrupted.pushReceive(CREW_TOKEN, { max: 10 })).rejects.toThrow('Notification unavailable');
    expect(await fleet.door.inbox(CREW_TOKEN)).toEqual({ isOk: true, value: { waiting: 1 } });
    expect(await contributions.unseen(SHIP, [HEADS_MEETING_ID])).toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);

    const restarted = createRecordingMeetingDoor(fleet.door, { contributions, changes: memoryInboxChanges() });
    const replayed = await restarted.pushReceive(CREW_TOKEN, { max: 10 });

    expect(replayed.isOk && replayed.value.map(({ messageId }) => messageId)).toEqual([contribution.messageId]);
    expect(await contributions.unseen(SHIP, [HEADS_MEETING_ID])).toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
    expect(await fleet.door.inbox(CREW_TOKEN)).toEqual({ isOk: true, value: { waiting: 0 } });
  });

  it('returns an acknowledgement refusal and retries it without duplicating the record', async () => {
    const contributions = memoryMeetingContributions();
    const fleet = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries: [aContribution()] });
    const refusal = { code: 'UNAVAILABLE', message: 'Core unavailable' };
    const refused = createRecordingMeetingDoor({ ...fleet.door, ack: () => Promise.resolve(err(refusal)) }, { contributions, changes: memoryInboxChanges() });

    expect(await refused.pushReceive(CREW_TOKEN, { max: 10 })).toEqual(err(refusal));
    expect(await fleet.door.inbox(CREW_TOKEN)).toEqual({ isOk: true, value: { waiting: 1 } });

    const restarted = createRecordingMeetingDoor(fleet.door, { contributions, changes: memoryInboxChanges() });
    await restarted.pushReceive(CREW_TOKEN, { max: 10 });

    expect(await contributions.unseen(SHIP, [HEADS_MEETING_ID])).toEqual([{ meetingId: HEADS_MEETING_ID, count: 1 }]);
    expect(await fleet.door.inbox(CREW_TOKEN)).toEqual({ isOk: true, value: { waiting: 0 } });
  });

  it('leaves meeting notices and ordinary deliveries waiting for the person', async () => {
    const notice = aPersonDelivery({ meetingId: HEADS_MEETING_ID, contentType: 'application/vnd.aeolus.meeting.mic+json' });
    const ordinary = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002' });
    const contribution = aPersonDelivery({ ...aContribution(), deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003' });
    const fleet = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries: [notice, ordinary, contribution] });
    const door = createRecordingMeetingDoor(fleet.door, { contributions: memoryMeetingContributions(), changes: memoryInboxChanges() });

    await door.pushReceive(CREW_TOKEN, { max: 10 });

    expect(fleet.ship.deliveries).toEqual([notice, ordinary]);
  });
});
