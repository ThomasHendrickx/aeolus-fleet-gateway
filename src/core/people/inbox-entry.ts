import { MEETING_ADDED_CONTENT_TYPE, MEETING_ENDED_CONTENT_TYPE, MEETING_MIC_CONTENT_TYPE, QUESTION_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE, questionSchema, replacementSchema, type DeliveryId, type Question, type ShipId } from '@aeolus-fleet/common';

import { essenceOf, jobOf, type ItemJob } from './item-job.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';

/** The longest title an inbox shows, as a message's headline is at most 80 characters. */
export const TITLE_MAX_LENGTH = 80;

/** A delivery as a person's inbox lists it: by titles only, so no payload leaves the fleet unopened (Q20). */
export interface InboxEntry {
  readonly deliveryId: DeliveryId;
  readonly from: string;
  /** The sender's ship id, by which a person's client quiets it (preferences design). */
  readonly fromShipId: ShipId;
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
  const title = delivery.headline ?? MEETING_NOTICE_TITLES.get(delivery.contentType) ?? delivery.payload.split('\n', 1)[0] ?? '';
  return title.length > TITLE_MAX_LENGTH ? `${title.slice(0, TITLE_MAX_LENGTH - 1)}…` : title;
}

export function inboxEntryOf(delivery: PersonDelivery): InboxEntry {
  return { deliveryId: delivery.deliveryId, from: delivery.senderName, fromShipId: delivery.senderShipId, title: titleOf(delivery), sentAt: delivery.sentAt.toISOString() };
}

export function openedEntryOf(opened: OpenedDelivery): InboxEntry {
  return { deliveryId: opened.deliveryId, from: opened.from, fromShipId: opened.senderShipId, title: opened.title, sentAt: opened.sentAt.toISOString() };
}

/** The option the asker of a question would pick, and why. */
export interface AskerPick {
  readonly option: number;
  readonly why: string;
}

/** An inbox entry as a chat lists it: with its job (Bridge, section 6), and for a question the asker's pick, so the chat can say what waits without opening (and so acknowledging) it. */
export interface ChatInboxEntry extends InboxEntry {
  readonly job: ItemJob;
  readonly pick: AskerPick | null;
}

/** The question a delivery asks: a question's own, or the new question a replacement asks; none for any other delivery or a payload that is no question. */
export function askedQuestionOf(delivery: Pick<PersonDelivery, 'contentType' | 'payload'>): Question | null {
  const essence = essenceOf(delivery.contentType);
  if (essence !== QUESTION_CONTENT_TYPE && essence !== REPLACEMENT_CONTENT_TYPE) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(delivery.payload);
  } catch {
    return null;
  }
  return (essence === QUESTION_CONTENT_TYPE ? questionSchema.safeParse(parsed).data : replacementSchema.safeParse(parsed).data?.question) ?? null;
}

/** The asker's pick of a question, or of the new question a replacement asks; none for any other delivery or a payload that is no question. */
function pickOf(delivery: Pick<PersonDelivery, 'contentType' | 'payload'>): AskerPick | null {
  return askedQuestionOf(delivery)?.pick ?? null;
}

export function chatInboxEntryOf(delivery: PersonDelivery): ChatInboxEntry {
  return { ...inboxEntryOf(delivery), job: jobOf(delivery.contentType), pick: pickOf(delivery) };
}

/** An opened delivery is kept without its payload, so it carries no pick; one opened before the gateway kept its content type is everything else. */
export function chatOpenedEntryOf(opened: OpenedDelivery): ChatInboxEntry {
  return { ...openedEntryOf(opened), job: jobOf(opened.contentType ?? ''), pick: null };
}
