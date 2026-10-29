import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

/**
 * A fleet message as it is in Slack, for a person ship (gateway scopes
 * 9.5): a delivery the gateway posts there, or the person's own message
 * sent from there. It keeps where it is, by the bot's app, the conversation
 * and its Slack message, so a reply goes into that conversation or thread
 * and an answer in a thread replies to it. A delivery's post is kept before
 * it is handed, then given its Slack message once Slack accepted it, then
 * acknowledged: a post the gateway did not finish is finished at the next
 * wake.
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
  /** A link posted for what Slack does not show in full: handed only, as a wake (B4). */
  readonly isLinkOnly: boolean;
  readonly ackedAt: Date | null;
}

/** Whether the post is a delivery the gateway did not finish: not yet in Slack, or not yet acknowledged. */
export function isUnfinished(post: SlackPost): boolean {
  return post.deliveryId !== null && (post.ts === null || (!post.isLinkOnly && post.ackedAt === null));
}
