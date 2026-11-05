import { describe, expect, it } from 'vitest';

import { aMeetingRead } from '../../../test/support/meeting-fakes.js';
import type { Inbox } from '../../core/people/read-inbox.js';
import { inboxWords, meetingWords, openedWords } from './person-words.js';

// What a person's chat reads aloud: sentences with the times in words, the
// ids only where the chat must pass one back, never a content type.

const ENTRY = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', from: 'tracker', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z', job: 'decide', pick: { option: 1, why: 'Every check is green' } } as const;

describe('the inbox, in words', () => {
  it('says how many wait, each with who sent it, when, its job, the asker\'s pick and the deliveryId to open it by', () => {
    const inbox: Inbox = { waiting: 1, deliveries: [ENTRY], opened: [] };

    expect(inboxWords(inbox)).toBe(
      ['1 waits for you.', 'Waiting:', '1. tracker, 2026-10-19 08:00 UTC, to decide: Go for release 1.4? tracker picks option 1: Every check is green. (deliveryId dlv_01m3tbfspe96yf1rnr4ank0001)', 'Opened and not answered or done yet: none.'].join('\n'),
    );
  });

  it('says nothing waits and lists what was opened', () => {
    const inbox: Inbox = { waiting: 0, deliveries: [], opened: [{ ...ENTRY, job: 'everything-else', pick: null, title: 'The build is red' }] };

    expect(inboxWords(inbox)).toBe(
      ['Nothing waits for you.', 'Opened and not answered or done yet:', '1. tracker, 2026-10-19 08:00 UTC, a message: The build is red (deliveryId dlv_01m3tbfspe96yf1rnr4ank0001)'].join('\n'),
    );
  });
});

describe('a meeting notice opened, in words', () => {
  it('says its sentence and the meeting to read, no payload and no content type', () => {
    expect(openedWords({ deliveryId: ENTRY.deliveryId, from: 'chief-of-staff', title: 'You were added to a meeting', sentAt: ENTRY.sentAt, contentType: 'application/vnd.aeolus.meeting.added+json', payload: '{}', meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg', said: 'chief-of-staff added you to the meeting “Weekly heads”.', stale: null })).toBe(
      'chief-of-staff added you to the meeting “Weekly heads”. (meetingId mtg_01m5qa5j85mgd4z61d9c2k4mtg)',
    );
  });
});

describe('a meeting, in words', () => {
  it('says the meeting, who is in it, the mic, where the person stands on it and the contributions newest first', () => {
    expect(meetingWords({ meeting: aMeetingRead(), mic: { kind: 'requested', place: 1 } })).toBe(
      [
        'Meeting “Weekly heads” (meetingId mtg_01m5qa5j85mgd4z61d9c2k4mtg), open since 2026-10-24 09:00 UTC.',
        'Owner chief-of-staff, moderator chief-of-staff.',
        'In it: chief-of-staff, head-of-marketing, charlotte.',
        'The mic is free and passes first come, first served. Nobody waits for it.',
        'You wait for the mic, number 1 in line.',
        'Contributions, newest first:',
        '- 2026-10-24 09:01 UTC chief-of-staff: Round robin: marketing first',
      ].join('\n'),
    );
  });
});
