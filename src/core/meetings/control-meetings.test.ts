import { describe, expect, it } from 'vitest';

import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { HEADS_MEETING_ID } from '../../../test/support/meeting-fakes.js';
import { ok, err } from '../shared/result.js';
import { createControlMeetings } from './control-meetings.js';
import type { MeetingControls } from './control-ports.js';

function controlling(refusalCode?: string) {
  const crews = memoryPersonCrews();
  const tokens: string[] = [];
  const door: MeetingControls = {
    list: (token) => { tokens.push(token); return Promise.resolve(refusalCode === undefined ? ok({ items: [], nextCursor: null }) : err({ code: refusalCode, message: 'Core refuses this meeting call' })); },
    change: (token) => { tokens.push(token); return Promise.resolve(refusalCode !== undefined ? err({ code: refusalCode, message: 'Core refuses this meeting call' }) : ok({ meetingId: HEADS_MEETING_ID })); },
  };
  return { controls: createControlMeetings({ crewPersonShip: fakeCrewPersonShip(crews), crews, door }), tokens };
}

describe('a person controls meetings as their own crew', () => {
  it('opens as the person and returns the meeting without the crew token', async () => {
    const { controls, tokens } = controlling();
    await expect(controls.change({ caller: CHARLOTTE_GRANT, command: { call: 'openMeeting', input: { ships: [{ name: 'chief-of-staff' }], idempotencyKey: 'open-1' } } })).resolves.toEqual(ok({ meetingId: HEADS_MEETING_ID }));
    expect(tokens).toEqual(['aeolus_ct_v1_charlotte']);
  });
  it.each(['FORBIDDEN', 'NOT_FOUND', 'BAD_REQUEST', 'CONFLICT'])('keeps core code %s when a meeting change is refused', async (code) => {
    const { controls } = controlling(code);
    await expect(controls.change({ caller: CHARLOTTE_GRANT, command: { call: 'openMeeting', input: { ships: [], idempotencyKey: 'open-1' } } })).resolves.toEqual(err({ kind: 'MEETING_REFUSED', code, message: 'Core refuses this meeting call' }));
  });
  it.each(['FORBIDDEN', 'NOT_FOUND', 'BAD_REQUEST', 'CONFLICT'])('keeps core code %s when a meeting page is refused', async (code) => {
    const { controls } = controlling(code);
    await expect(controls.list({ caller: CHARLOTTE_GRANT, page: { limit: 20 } })).resolves.toEqual(err({ kind: 'MEETING_REFUSED', code, message: 'Core refuses this meeting call' }));
  });
  it('reads a page as the person', async () => {
    const { controls, tokens } = controlling();
    await expect(controls.list({ caller: CHARLOTTE_GRANT, page: { limit: 20 } })).resolves.toEqual(ok({ items: [], nextCursor: null }));
    expect(tokens).toEqual(['aeolus_ct_v1_charlotte']);
  });
  it('refuses a caller with no person ship before calling core', async () => {
    const { controls, tokens } = controlling();
    await expect(controls.list({ caller: { ...CHARLOTTE_GRANT, grantId: 'grant-2' }, page: { limit: 20 } })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(tokens).toEqual([]);
  });
});
