/**
 * A meeting notice (decision 0061, M11) as a person is told it: a sentence
 * that names who and which meeting, never the notice's payload with its ids.
 * A mic or ended notice only names the meeting by id, so it says no title.
 */
import { MEETING_ADDED_CONTENT_TYPE, MEETING_ENDED_CONTENT_TYPE, MEETING_MIC_CONTENT_TYPE, meetingAddedSchema } from '@aeolus-fleet/common';

import { essenceOf } from './item-job.js';
import type { PersonDelivery } from './ports.js';

/** The sentence a meeting notice says; none for any other delivery, or a notice whose payload does not read. */
export function meetingNoticeSaid(delivery: Pick<PersonDelivery, 'contentType' | 'payload'> & { from: string }): string | null {
  switch (essenceOf(delivery.contentType)) {
    case MEETING_ADDED_CONTENT_TYPE: {
      let parsed: unknown;
      try {
        parsed = JSON.parse(delivery.payload);
      } catch {
        return null;
      }
      const added = meetingAddedSchema.safeParse(parsed);
      if (!added.success) {
        return null;
      }
      return `${delivery.from} added you to ${added.data.title === null ? 'a meeting' : `the meeting “${added.data.title}”`}.`;
    }
    case MEETING_MIC_CONTENT_TYPE:
      return 'You hold the mic of a meeting.';
    case MEETING_ENDED_CONTENT_TYPE:
      return 'A meeting you took part in ended.';
    default:
      return null;
  }
}
