import type { DeliveryId, FleetId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { PersonDelivery, PersonShip, PersonShipDoor, PushedPersonDelivery } from '../people/ports.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackButton, SlackLinks, SlackMessages, SlackPosts } from './ports.js';
import type { SlackApp } from './slack-app.js';
import type { SlackLink } from './slack-link.js';
import { slackPostOf } from './slack-post-of.js';
import type { SlackPost } from './slack-post.js';

/** How often a post Slack rate limits is asked again within one wake. */
const RATE_LIMITED_TRIES = 3;

const SECOND_MS = 1000;

/** The number a delivery is handed with: the first hand-over, made again with the same number counts nothing (0040). */
const FIRST_HAND_OVER = 1;

export type ShowInSlack = (ship: PersonShip, wake: { crewToken: string; fresh: readonly PushedPersonDelivery[] }) => Promise<Result<ReadonlySet<DeliveryId>, FleetRefusal>>;

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
 * (gateway scopes 9.5), as the gateway wakes them. A reply to a message
 * from Slack goes into that conversation or thread; a bot ship's message
 * into that bot's direct messages with the person (P-B1); anything else
 * through the gateway's own bot, headed by the sender, once the person
 * turned Slack on (B5). A bot removed in Slack falls back to the gateway's
 * bot, with Slack on. Each delivery is kept as a post, handed with channel
 * slack, posted, given its Slack message, then acknowledged (B4); a link for
 * what Slack does not show in full is handed only, as a wake. Slack rate
 * limited: the post waits Retry-After and goes again with the same hand-over.
 * Slack refused the post: nothing is kept, and web push and email wake as
 * before. A post the gateway did not finish (it stopped, or core refused
 * the acknowledgement) is finished first, never posted twice once in Slack.
 * It answers the deliveries Slack showed, which no other channel wakes for.
 */
export function createShowInSlack(deps: {
  links: Pick<SlackLinks, 'ofPersonShip'>;
  apps: Pick<SlackApps, 'find' | 'ofShip' | 'gatewayBot'>;
  posts: SlackPosts;
  slack: Pick<SlackMessages, 'post'>;
  door: Pick<PersonShipDoor, 'pushReceive' | 'handed' | 'ack'>;
  sleep: Sleep;
  clock: Clock;
  overviewUrlOf: (fleetId: FleetId) => string;
}): ShowInSlack {
  const whereOf = async (link: SlackLink, delivery: PersonDelivery): Promise<Where | undefined> => {
    const { fleetId, personShipId, slackUserId, isShowingAll } = link;
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
    const gatewayBot = isShowingAll ? await deps.apps.gatewayBot(fleetId) : undefined;
    return isInSlack(gatewayBot) ? { app: gatewayBot, channel: slackUserId, threadTs: null } : undefined;
  };

  /** Posts it, waiting out Slack's rate limits: the Slack message, or none when Slack refused it. */
  const posted = async (where: Where, shown: { text: string; buttons: readonly SlackButton[] }): Promise<string | undefined> => {
    for (let tried = 1; ; tried += 1) {
      const answered = await deps.slack.post(where.app.bot.token, { channel: where.channel, threadTs: where.threadTs, text: shown.text, buttons: shown.buttons });
      if (answered.isOk) {
        return answered.value.ts;
      }
      if (answered.error.kind !== 'rateLimited' || tried >= RATE_LIMITED_TRIES) {
        return undefined;
      }
      await deps.sleep(answered.error.retryAfterSeconds * SECOND_MS, new AbortController().signal);
    }
  };

  /**
   * Posts a kept post not yet in Slack, then acknowledges it unless a link:
   * whether it is in Slack now. A delivery no longer waiting was
   * acknowledged meanwhile: a post not yet in Slack is forgotten, one in
   * Slack is finished.
   */
  const finish = async ({ crewToken, post, delivery }: { crewToken: string; post: SlackPost & { deliveryId: DeliveryId }; delivery: PersonDelivery | undefined }): Promise<boolean> => {
    let current = post;
    if (current.ts === null) {
      if (delivery === undefined) {
        await deps.posts.remove(post.fleetId, post);
        return false;
      }
      const app = await deps.apps.find(post.fleetId, post.appId);
      const shown = slackPostOf(delivery, { overviewUrl: deps.overviewUrlOf(post.fleetId), isHeadedBySender: app?.shipId === null });
      const ts = isInSlack(app) ? await posted({ app, channel: post.channel, threadTs: post.threadTs }, shown.kind === 'shown' ? shown : { text: shown.text, buttons: [] }) : undefined;
      if (ts === undefined) {
        await deps.posts.remove(post.fleetId, post);
        return false;
      }
      current = { ...current, ts };
      await deps.posts.save(current);
    }
    if (delivery === undefined && !current.isLinkOnly) {
      await deps.posts.save({ ...current, ackedAt: deps.clock.now() });
      return true;
    }
    if (!current.isLinkOnly && current.ackedAt === null) {
      const acked = await deps.door.ack(crewToken, post.deliveryId);
      if (acked.isOk) {
        await deps.posts.save({ ...current, ackedAt: deps.clock.now() });
      }
    }
    return true;
  };

  return async (ship, { crewToken, fresh }) => {
    const link = await deps.links.ofPersonShip(ship.fleetId, ship.shipId);
    const shownIds = new Set<DeliveryId>();
    if (link?.stoppedAt !== null) {
      return ok(shownIds);
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
          await finish({ crewToken, post: { ...post, deliveryId }, delivery: held.value.find((each) => each.deliveryId === deliveryId) });
        }
      }
    }
    for (const delivery of fresh) {
      const where = await whereOf(link, delivery);
      if (where === undefined) {
        continue;
      }
      const shown = slackPostOf(delivery, { overviewUrl: deps.overviewUrlOf(ship.fleetId), isHeadedBySender: where.app.shipId === null });
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
        isLinkOnly: shown.kind === 'link',
        ackedAt: null,
      };
      // Kept before it is handed: a gateway that stops in between finishes it at the next wake.
      await deps.posts.save(post);
      const handed = await deps.door.handed(crewToken, { deliveryId: delivery.deliveryId, handOverNumber: FIRST_HAND_OVER, channel: 'slack' });
      if (!handed.isOk || handed.value !== 'handed') {
        await deps.posts.remove(ship.fleetId, post);
        continue;
      }
      if (await finish({ crewToken, post: { ...post, deliveryId: delivery.deliveryId }, delivery })) {
        shownIds.add(delivery.deliveryId);
      }
    }
    return ok(shownIds);
  };
}
