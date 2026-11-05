import { describe, expect, it } from 'vitest';

import { meetingNoticeSaid } from './meeting-notice.js';

// A meeting notice (decision 0061, M11) is said to a person as a sentence, never as its payload.

const MEETING_ID = 'mtg_01m5qa5j85mgd4z61d9c2k4mtg';
const SHIP_ID = 'shp_01m5qa5j85mgd4z61d9c2k4shp';
const ADDED = 'application/vnd.aeolus.meeting.added+json';
const addedPayload = (title: string | null): string =>
  JSON.stringify({ meetingId: MEETING_ID, title, owner: { id: SHIP_ID, name: 'chief-of-staff' }, moderator: { id: SHIP_ID, name: 'chief-of-staff' }, participants: [{ id: SHIP_ID, name: 'chief-of-staff' }] });

describe('a meeting notice, said as a sentence', () => {
  it('says who added the person to which meeting', () => {
    expect(meetingNoticeSaid({ contentType: ADDED, payload: addedPayload('Weekly heads'), from: 'chief-of-staff' })).toBe('chief-of-staff added you to the meeting “Weekly heads”.');
  });

  it('says a meeting without a title is a meeting', () => {
    expect(meetingNoticeSaid({ contentType: ADDED, payload: addedPayload(null), from: 'chief-of-staff' })).toBe('chief-of-staff added you to a meeting.');
  });

  it('says the person holds the mic', () => {
    expect(meetingNoticeSaid({ contentType: 'application/vnd.aeolus.meeting.mic+json', payload: JSON.stringify({ meetingId: MEETING_ID }), from: 'chief-of-staff' })).toBe('You hold the mic of a meeting.');
  });

  it('says the meeting ended', () => {
    expect(meetingNoticeSaid({ contentType: 'application/vnd.aeolus.meeting.ended+json', payload: JSON.stringify({ meetingId: MEETING_ID }), from: 'chief-of-staff' })).toBe('A meeting you took part in ended.');
  });

  it('says nothing of a notice whose payload does not read, so the payload shows as it came', () => {
    expect(meetingNoticeSaid({ contentType: ADDED, payload: 'not json', from: 'chief-of-staff' })).toBeNull();
  });

  it('says nothing of any other delivery', () => {
    expect(meetingNoticeSaid({ contentType: 'text/plain', payload: 'hello', from: 'chief-of-staff' })).toBeNull();
  });
});
