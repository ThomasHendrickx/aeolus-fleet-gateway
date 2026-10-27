import { describe, expect, it } from 'vitest';

import { meetingNoticeTextOf } from './meeting-notice.js';

const ADDED = {
  from: 'chief-of-staff',
  contentType: 'application/vnd.aeolus.meeting.added+json',
  payload: '{"meetingId":"mtg_01m5qa5j85mgd4z61d9c2k4mtg","title":"Weekly heads","owner":{"id":"shp_01m5qa5j85mgd4z61d9c2k0001","name":"chief-of-staff"},"moderator":{"id":"shp_01m5qa5j85mgd4z61d9c2k0001","name":"chief-of-staff"},"participants":[]}',
};

describe('an added-to-meeting notice', () => {
  it('names who added the person and the titled meeting', () => {
    expect(meetingNoticeTextOf(ADDED)).toBe('chief-of-staff added you to the meeting “Weekly heads”.');
  });

  it('names an untitled meeting without its payload', () => {
    expect(meetingNoticeTextOf({ ...ADDED, payload: ADDED.payload.replace('"Weekly heads"', 'null') })).toBe('chief-of-staff added you to a meeting.');
  });

  it.each([
    { what: 'a different content type', delivery: { ...ADDED, contentType: 'text/plain' } },
    { what: 'invalid JSON', delivery: { ...ADDED, payload: '{' } },
    { what: 'a payload outside the meeting-added schema', delivery: { ...ADDED, payload: '{"meetingId":"mtg_01m5qa5j85mgd4z61d9c2k4mtg"}' } },
  ])('leaves $what to its caller', ({ delivery }) => {
    expect(meetingNoticeTextOf(delivery)).toBeUndefined();
  });
});
