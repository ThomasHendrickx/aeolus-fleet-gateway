import type { DeliveryId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { PersonCrew, PersonCrews } from '../people/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackLinks, SlackPosts, SlackSignatures } from './ports.js';
import type { SlackApp } from './slack-app.js';
import { isSignedBy, type SignedRequest } from './slack-request.js';
import type { SlackPost } from './slack-post.js';

/** A press of a button under a post of the gateway's: the app, who pressed it, the Slack message it is under, and the fleet message its buttons name. */
export interface SlackPress extends SignedRequest {
  readonly appId: string;
  readonly teamId: string;
  readonly userId: string;
  readonly channel: string;
  readonly messageTs: string;
  readonly messageId: MessageId;
}

/** What a press acts on: the bot it was pressed under, the delivery's post, and the crew of the person ship it was posted to. */
export interface Pressed {
  readonly app: SlackApp & { readonly bot: NonNullable<SlackApp['bot']> };
  readonly post: SlackPost & { readonly deliveryId: DeliveryId; readonly senderShipId: ShipId };
  readonly crew: PersonCrew;
}

/**
 * What a press acts on, signed as an event is, by the person the delivery
 * was posted to, in the conversation it was posted in; none for anything
 * else, which the press leaves alone. The press names the delivery's fleet
 * message, as its button carries it, so a press that comes before the
 * gateway kept the post's Slack message is found too.
 */
export async function pressedOf(
  deps: { apps: Pick<SlackApps, 'findByAppId'>; links: Pick<SlackLinks, 'find'>; posts: Pick<SlackPosts, 'ofMessage'>; crews: Pick<PersonCrews, 'find'>; signatures: SlackSignatures; clock: Clock },
  press: SlackPress,
): Promise<Result<Pressed | undefined, { kind: 'notSigned' }>> {
  const { appId, teamId, userId, channel, messageId, body, timestamp, signature } = press;
  const app = await deps.apps.findByAppId(appId);
  if (!isSignedBy(app, { request: { body, timestamp, signature }, signatures: deps.signatures, clock: deps.clock })) {
    return err({ kind: 'notSigned' });
  }
  const link = await deps.links.find(app.fleetId, { teamId, userId });
  const kept = link?.stoppedAt === null ? await deps.posts.ofMessage(app.fleetId, { personShipId: link.personShipId, messageId }) : undefined;
  const post = kept?.appId === appId && kept.channel === channel ? kept : undefined;
  const crew = post === undefined ? undefined : await deps.crews.find(app.fleetId, post.personShipId);
  const { bot } = app;
  if (post === undefined || post.deliveryId === null || post.senderShipId === null || crew === undefined || bot === null) {
    return ok(undefined);
  }
  return ok({ app: { ...app, bot }, post: { ...post, deliveryId: post.deliveryId, senderShipId: post.senderShipId }, crew });
}
