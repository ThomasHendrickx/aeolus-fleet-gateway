import { MEETING_ADDED_CONTENT_TYPE, MEETING_ENDED_CONTENT_TYPE, MEETING_MIC_CONTENT_TYPE, type DeliveryId } from '@aeolus-fleet/common';

import type { OpenedDelivery, PersonDelivery } from './ports.js';

/** The longest title an inbox shows, as a message's headline is at most 80 characters. */
export const TITLE_MAX_LENGTH = 80;

/** A delivery as a person's inbox lists it: by titles only, so no payload leaves the fleet unopened (Q20). */
export interface InboxEntry {
  readonly deliveryId: DeliveryId;
  readonly from: string;
  readonly title: string;
  readonly sentAt: string;
}

/** The title of each meeting notice (decision 0061, M11), whose payload only names the meeting. */
const MEETING_NOTICE_TITLES = new Map([
  [MEETING_ADDED_CONTENT_TYPE, 'You were added to a meeting'],
  [MEETING_MIC_CONTENT_TYPE, 'You hold the mic of a meeting'],
  [MEETING_ENDED_CONTENT_TYPE, 'A meeting you took part in ended'],
]);

/** A question's own title; a meeting notice's in words; any other message's first line, cut to the longest title. */
export function titleOf(delivery: PersonDelivery): string {
  const title = delivery.questionTitle ?? MEETING_NOTICE_TITLES.get(delivery.contentType) ?? delivery.payload.split('\n', 1)[0] ?? '';
  return title.length > TITLE_MAX_LENGTH ? `${title.slice(0, TITLE_MAX_LENGTH - 1)}…` : title;
}

export function inboxEntryOf(delivery: PersonDelivery): InboxEntry {
  return { deliveryId: delivery.deliveryId, from: delivery.senderName, title: titleOf(delivery), sentAt: delivery.sentAt.toISOString() };
}

export function openedEntryOf(opened: OpenedDelivery): InboxEntry {
  return { deliveryId: opened.deliveryId, from: opened.from, title: opened.title, sentAt: opened.sentAt.toISOString() };
}
