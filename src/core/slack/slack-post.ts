import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { ItemOutcome } from '../people/item-outcome.js';

/**
 * A fleet message as it is in Slack, for a person ship (gateway scopes
 * 9.5): a delivery the gateway posts there, or the person's own message
 * sent from there. It keeps where it is, by the bot's app, the conversation
 * and its Slack message, so a reply goes into that conversation or thread
 * and an answer in a thread replies to it. A delivery's post is kept before
 * it is handed, then given its Slack message once Slack accepted it: a post
 * the gateway did not finish is finished at the next wake. It is never
 * acknowledged on post; only the person's action does that (Bridge, CC6).
 */
export interface SlackPost {
  readonly fleetId: FleetId;
  readonly personShipId: ShipId;
  readonly messageId: MessageId;
  /** The delivery posted; none for the person's own message. */
  readonly deliveryId: DeliveryId | null;
  /** The ship that sent the delivery; none for the person's own message. */
  readonly senderShipId: ShipId | null;
  readonly appId: string;
  readonly channel: string;
  /** The Slack message, once Slack accepted the post. */
  readonly ts: string | null;
  /** The thread it is in, if any. */
  readonly threadTs: string | null;
}

/** A post in Slack whose item something came of, in any place, with what came of it, to edit so (Bridge, section 7, view sync). */
export interface PostToEdit {
  readonly post: SlackPost & { readonly deliveryId: DeliveryId; readonly ts: string };
  readonly outcome: Pick<ItemOutcome, 'place' | 'kind' | 'option' | 'at'>;
}

/** How Slack's ids begin: a person's user id, and the conversation id of direct messages. */
const USER_ID = /^[UW]/;
const DIRECT_MESSAGES_PREFIX = 'D';

/**
 * Whether the post is in the conversation, through the bot's app. A post
 * to a person's direct messages goes by their user id, and Slack names the
 * conversation by an id of its own only once it answers: until then, the
 * post kept by a user id is in the direct messages of its person ship's
 * person with that bot, the only ones a person ship's posts go to by user
 * id (aeolus-fleet#1573).
 */
export function isPostIn(post: SlackPost, conversation: { appId: string; channel: string }): boolean {
  const isInDirectMessages = USER_ID.test(post.channel) && conversation.channel.startsWith(DIRECT_MESSAGES_PREFIX);
  return post.appId === conversation.appId && (post.channel === conversation.channel || isInDirectMessages);
}

/**
 * Whether the post is a delivery not yet in Slack that starts a thread in
 * the conversation: a reply in a thread there that matches no post may be
 * under it, before the gateway keeps its Slack message.
 */
export function isAwaitingSlackIn(post: SlackPost, conversation: { appId: string; channel: string }): boolean {
  return post.deliveryId !== null && post.ts === null && post.threadTs === null && isPostIn(post, conversation);
}

/** Whether the post is a delivery the gateway did not finish: not yet in Slack. */
export function isUnfinished(post: SlackPost): boolean {
  return post.deliveryId !== null && post.ts === null;
}
