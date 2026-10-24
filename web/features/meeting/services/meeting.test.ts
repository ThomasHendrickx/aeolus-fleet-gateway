import { describe, expect, it } from 'vitest';

import { contributionOf, micLineOf, standingOf, type MeetingView } from './meeting';

const CHIEF = { shipId: 'shp_01m5qa5j85mgd4z61d9c2kchf0', name: 'chief-of-staff' } as const;
const MARKETING = { shipId: 'shp_01m5qa5j85mgd4z61d9c2kmkt0', name: 'head-of-marketing' } as const;

function aMeeting(overrides: Partial<MeetingView> = {}): MeetingView {
  return {
    meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg',
    title: 'Weekly heads',
    owner: CHIEF,
    moderator: CHIEF,
    openedAt: '2026-10-24T09:00:00.000Z',
    endedAt: null,
    participants: [],
    mic: { holder: null, pattern: 'fifo', requests: [] },
    contributions: { items: [], nextCursor: null },
    yourMic: { kind: 'none' },
    ...overrides,
  };
}

describe('what the meeting page offers the person, by where they stand on the mic (decision 0061, M7 to M10)', () => {
  it('offers a request for the mic to a person without it', () => {
    expect(standingOf(aMeeting())).toEqual({ controls: ['request'], said: 'Request the mic to contribute.' });
  });

  it('offers to withdraw a request, saying the place in line', () => {
    expect(standingOf(aMeeting({ yourMic: { kind: 'requested', place: 2 } }))).toEqual({ controls: ['withdraw'], said: 'You are number 2 in line for the mic.' });
  });

  it('offers to contribute and to release the mic to the person holding it', () => {
    expect(standingOf(aMeeting({ yourMic: { kind: 'holding' } }))).toEqual({ controls: ['contribute', 'release'], said: 'You hold the mic: contribute, then release it once you are done.' });
  });

  it('offers the moderator to contribute without the mic', () => {
    expect(standingOf(aMeeting({ yourMic: { kind: 'moderating' } }))).toEqual({ controls: ['contribute'], said: 'You moderate: you contribute without the mic.' });
  });

  it('offers nothing once the meeting ended, saying when', () => {
    expect(standingOf(aMeeting({ endedAt: '2026-10-24T10:00:00.000Z', yourMic: { kind: 'holding' } }))).toEqual({ controls: [], said: 'This meeting ended on Sat, 24 Oct 2026 10:00:00 GMT.' });
  });
});

describe("the meeting page's line on the mic", () => {
  it('says the mic is free and goes to the first in line', () => {
    expect(micLineOf(aMeeting())).toBe('The mic is free; it goes to the first in line.');
  });

  it('says who holds the mic and that the moderator gives it', () => {
    expect(micLineOf(aMeeting({ mic: { holder: MARKETING, pattern: 'moderator', requests: [] } }))).toBe('head-of-marketing holds the mic; the moderator gives it.');
  });
});

describe('a contribution the person writes on the meeting page', () => {
  it('sends the text, trimmed', () => {
    expect(contributionOf('  Marketing is on track \n')).toEqual({ isOk: true, value: 'Marketing is on track' });
  });

  it('asks for the text before sending an empty contribution', () => {
    expect(contributionOf(' \n ')).toEqual({ isOk: false, message: 'Write your contribution first' });
  });
});
