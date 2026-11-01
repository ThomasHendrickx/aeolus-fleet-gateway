import type { DeliveryId, FleetId, MessageId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Sleep } from '../mcp-out/run-party.js';
import { jobOf } from '../people/item-job.js';
import type { PersonDelivery, PersonShip, PersonShipDoor, PushedPersonDelivery, ShownThere } from '../people/ports.js';
import type { Routing } from '../people/routing.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackLinks, SlackMessage, SlackMessages, SlackPosts } from './ports.js';
import type { SlackApp } from './slack-app.js';
import type { SlackLink } from './slack-link.js';
import { slackPostOf } from './slack-post-of.js';
import type { SlackPost } from './slack-post.js';

/** How often a post Slack rate limits is asked again within one wake. */
const RATE_LIMITED_TRIES = 3;

const SECOND_MS = 1000;

/** The number a delivery is handed with: the first hand-over, made again with the same number counts nothing (0040). */
const FIRST_HAND_OVER = 1;

export type ShowInSlack = (ship: PersonShip, wake: { crewToken: string; fresh: readonly PushedPersonDelivery[]; routing: Routing }) => Promise<Result<ShownThere, FleetRefusal>>;

/**
 * What came of a kept post: in Slack, not shown and forgotten, or not yet
 * in Slack and kept, its delivery waiting beyond the read.
 */
type Finished = 'shown' | 'notShown' | 'waiting';

/** Where a delivery shows in Slack: through which bot, in which conversation and thread. */
interface Where {
  readonly app: SlackApp & { readonly bot: NonNullable<SlackApp['bot']> };
  readonly channel: string;
  readonly threadTs: string | null;
}

function isInSlack(app: SlackApp | undefined): app is Where['app'] {
  return app !== undefined && app.bot !== null && app.removedInSlackAt === null;
}

/**
 * Use case: shows what waits for a linked person's person ship in Slack
 * (gateway scopes 9.5), as the gateway wakes them, each job once the person
 * turned Slack on for it, only what arrived since (Bridge, section 8). A
 * reply to a message from Slack goes into that conversation or thread; a
 * bot ship's message into that bot's direct messages with the person
 * (P-B1); anything else through the gateway's own bot, headed by the
 * sender. With Slack off for everything else, a bot ship's messages and
 * replies into Slack still show there, as before routing; with it off for
 * any other job, nothing of that job does. A bot removed in Slack falls back
 * to the gateway's bot, with Slack on for the job. Each delivery is kept as
 * a post, handed with channel slack, posted and given its Slack message,
 * never acknowledged: only the person's action does that (CC6). Slack rate
 * limited: the post waits Retry-After and goes again with the same
 * hand-over. Slack refused the post: nothing is kept, and the wakes go on
 * as before. A post the gateway did not finish (it stopped in between) is
 * finished first, at every wake, never posted twice once in Slack. It
 * answers the deliveries Slack showed, which no other channel wakes for,
 * and whether a post is left unfinished.
 */
export function createShowInSlack(deps: {
  links: Pick<SlackLinks, 'ofPersonShip'>;
  apps: Pick<SlackApps, 'find' | 'ofShip' | 'gatewayBot'>;
  posts: SlackPosts;
  slack: Pick<SlackMessages, 'post'>;
  door: Pick<PersonShipDoor, 'pushReceive' | 'handed' | 'ack'>;
  sleep: Sleep;
  clock: Clock;
  bridgeUrlOf: (fleetId: FleetId) => string;
}): ShowInSlack {
  /** Where it shows: with Slack on for its job, through the gateway's own bot too; off, only in a Slack thread or a bot ship's own conversation. */
  const whereOf = async (link: SlackLink, { delivery, isOn }: { delivery: PersonDelivery; isOn: boolean }): Promise<Where | undefined> => {
    const { fleetId, personShipId, slackUserId } = link;
    const repliedTo = delivery.inReplyTo === null ? undefined : await deps.posts.ofMessage(fleetId, { personShipId, messageId: delivery.inReplyTo });
    if (repliedTo !== undefined) {
      const app = await deps.apps.find(fleetId, repliedTo.appId);
      if (isInSlack(app)) {
        return { app, channel: repliedTo.channel, threadTs: repliedTo.threadTs ?? repliedTo.ts };
      }
    }
    const bot = await deps.apps.ofShip(fleetId, delivery.senderShipId);
    if (isInSlack(bot)) {
      return { app: bot, channel: slackUserId, threadTs: null };
    }
    const gatewayBot = isOn ? await deps.apps.gatewayBot(fleetId) : undefined;
    return isInSlack(gatewayBot) ? { app: gatewayBot, channel: slackUserId, threadTs: null } : undefined;
  };

  /** Posts it, waiting out Slack's rate limits: the conversation Slack answered it is in and its Slack message, or none when Slack refused it. */
  const posted = async (where: Where, shown: { messageId: MessageId; message: SlackMessage }): Promise<{ channel: string; ts: string } | undefined> => {
    for (let tried = 1; ; tried += 1) {
      const answered = await deps.slack.post(where.app.bot.token, { messageId: shown.messageId, channel: where.channel, threadTs: where.threadTs, message: shown.message });
      if (answered.isOk) {
        return answered.value;
      }
      if (answered.error.kind !== 'rateLimited' || tried >= RATE_LIMITED_TRIES) {
        return undefined;
      }
      await deps.sleep(answered.error.retryAfterSeconds * SECOND_MS, new AbortController().signal);
    }
  };

  /**
   * Posts a kept post not yet in Slack. One whose delivery the read did not
   * hold is handed again with the same number, which counts nothing: still
   * handed, it waits for a later read; acknowledged meanwhile, or
   * undeliverable, it is forgotten.
   */
  const finish = async ({ crewToken, post, delivery }: { crewToken: string; post: SlackPost & { deliveryId: DeliveryId }; delivery: PersonDelivery | undefined }): Promise<Finished> => {
    if (post.ts === null) {
      if (delivery === undefined) {
        const handed = await deps.door.handed(crewToken, { deliveryId: post.deliveryId, handOverNumber: FIRST_HAND_OVER, channel: 'slack' });
        if (!handed.isOk || handed.value === 'handed') {
          return 'waiting';
        }
        await deps.posts.remove(post.fleetId, post);
        return 'notShown';
      }
      const app = await deps.apps.find(post.fleetId, post.appId);
      const { text, item, buttons } = slackPostOf(delivery, { bridgeUrl: deps.bridgeUrlOf(post.fleetId), isHeadedBySender: app?.shipId === null });
      const inSlack = isInSlack(app) ? await posted({ app, channel: post.channel, threadTs: post.threadTs }, { messageId: post.messageId, message: { text, item, buttons } }) : undefined;
      if (inSlack === undefined) {
        await deps.posts.remove(post.fleetId, post);
        return 'notShown';
      }
      // Kept in the conversation Slack answered: a post to a person's user id is in their direct messages, which Slack names by an id of its own.
      await deps.posts.save({ ...post, ...inSlack });
    }
    return 'shown';
  };

  return async (ship, { crewToken, fresh, routing }) => {
    const link = await deps.links.ofPersonShip(ship.fleetId, ship.shipId);
    const shownIds = new Set<DeliveryId>();
    let isAnyUnfinished = false;
    if (link?.stoppedAt !== null) {
      return ok({ shown: shownIds, isAnyUnfinished });
    }
    const unfinished = await deps.posts.unfinished(ship.fleetId, ship.shipId);
    if (unfinished.length > 0) {
      // A post not yet in Slack needs its delivery, handed already: read with the held ones again.
      const held = await deps.door.pushReceive(crewToken, { max: unfinished.length + fresh.length });
      if (!held.isOk) {
        return held;
      }
      for (const post of unfinished) {
        const { deliveryId } = post;
        if (deliveryId !== null) {
          const finished = await finish({ crewToken, post: { ...post, deliveryId }, delivery: held.value.find((each) => each.deliveryId === deliveryId) });
          isAnyUnfinished ||= finished === 'waiting';
        }
      }
    }
    for (const delivery of fresh) {
      const isOn = routing.isShowing('slack', delivery);
      // Off for everything else, a bot ship's messages and replies into Slack still show, as before routing; off for another job, none.
      const where = isOn || jobOf(delivery.contentType) === 'everything-else' ? await whereOf(link, { delivery, isOn }) : undefined;
      if (where === undefined) {
        continue;
      }
      const post: SlackPost = {
        fleetId: ship.fleetId,
        personShipId: ship.shipId,
        messageId: delivery.messageId,
        deliveryId: delivery.deliveryId,
        senderShipId: delivery.senderShipId,
        appId: where.app.appId,
        channel: where.channel,
        ts: null,
        threadTs: where.threadTs,
      };
      // Kept before it is handed: a gateway that stops in between finishes it at the next wake.
      await deps.posts.save(post);
      const handed = await deps.door.handed(crewToken, { deliveryId: delivery.deliveryId, handOverNumber: FIRST_HAND_OVER, channel: 'slack' });
      if (!handed.isOk || handed.value !== 'handed') {
        await deps.posts.remove(ship.fleetId, post);
        continue;
      }
      const finished = await finish({ crewToken, post: { ...post, deliveryId: delivery.deliveryId }, delivery });
      if (finished === 'shown') {
        shownIds.add(delivery.deliveryId);
      }
    }
    return ok({ shown: shownIds, isAnyUnfinished });
  };
}
