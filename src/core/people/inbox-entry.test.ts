import { describe, expect, it } from 'vitest';

import { aPersonDelivery } from '../../../test/support/people-fakes.js';
import { titleOf } from './inbox-entry.js';

describe('the title of a meeting notice, as the record and an opened item say it', () => {
  it.each([
    ['application/vnd.aeolus.meeting.added+json', 'You were added to a meeting'],
    ['application/vnd.aeolus.meeting.mic+json', 'You hold the mic of a meeting'],
    ['application/vnd.aeolus.meeting.ended+json', 'A meeting you took part in ended'],
  ])('titles a notice of %s in words, not by its payload', (contentType, title) => {
    const notice = aPersonDelivery({ contentType, payload: '{"meetingId":"mtg_01m5qa5j85mgd4z61d9c2k4mtg"}', headline: null, meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' });

    expect(titleOf(notice)).toBe(title);
  });
});
