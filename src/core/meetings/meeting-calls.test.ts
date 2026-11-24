import { describe, expect, it } from 'vitest';
import { HEADS_MEETING_ID } from '../../../test/support/meeting-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { err, ok } from '../shared/result.js';
import { createMeetingCalls, type MeetingCallDoor } from './meeting-calls.js';

describe('meeting calls as a person ship', () => {
  it('opens a call as the person crew and returns the call id', async () => {
    const calls: unknown[] = [];
    const callId = 'msg_01m5qa5j85mgd4z61d9c2k0001' as const;
    const door: MeetingCallDoor = {
      openCall: (token, input) => { calls.push({ token, input }); return Promise.resolve(ok({ callId })); },
      ackMeetingUpTo: () => Promise.resolve(ok({ acknowledged: 0 })),
    };
    const crews = memoryPersonCrews();
    const meetingCalls = createMeetingCalls({ crews, crewPersonShip: fakeCrewPersonShip(crews), door });
    const call = { meetingId: HEADS_MEETING_ID, question: 'Friday?', idempotencyKey: 'call-1' };
    await expect(meetingCalls.open({ caller: CHARLOTTE_GRANT, call })).resolves.toEqual(ok({ callId }));
    expect(calls).toEqual([{ token: 'aeolus_ct_v1_charlotte', input: call }]);
  });

  it('passes through the fleet refusal to mark contributions read', async () => {
    const door: MeetingCallDoor = {
      openCall: () => Promise.resolve(ok({ callId: 'msg_01m5qa5j85mgd4z61d9c2k0001' })),
      ackMeetingUpTo: () => Promise.resolve(err({ code: 'NOT_FOUND', message: 'Meeting not found' })),
    };
    const crews = memoryPersonCrews();
    const meetingCalls = createMeetingCalls({ crews, crewPersonShip: fakeCrewPersonShip(crews), door });
    await expect(meetingCalls.acknowledge({ caller: CHARLOTTE_GRANT, read: { meetingId: HEADS_MEETING_ID, messageId: 'msg_01m5qa5j85mgd4z61d9c2k0001' } })).resolves.toEqual(err({ kind: 'MEETING_REFUSED', code: 'NOT_FOUND', message: 'Meeting not found' }));
  });
});
