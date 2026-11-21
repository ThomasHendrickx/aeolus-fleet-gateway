/** Meeting contributions have their own seen state, outside ordinary inbox items, whatever their content type. */
import type { MeetingId } from '@aeolus-fleet/common';

import { isMeetingNotice } from '../people/item-job.js';
import type { PersonDelivery } from '../people/ports.js';

export function isMeetingContribution<T extends Pick<PersonDelivery, 'meetingId' | 'contentType'>>(delivery: T): delivery is T & { readonly meetingId: MeetingId } {
  return delivery.meetingId !== null && !isMeetingNotice(delivery.contentType);
}
