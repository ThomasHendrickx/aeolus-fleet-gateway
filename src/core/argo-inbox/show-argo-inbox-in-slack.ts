import type { DeliveryId, FleetId, MessageId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import { routingOf, type RoutingDefaults, type Routes } from '../people/routing.js';
import type { ShipNames, SlackApps, SlackLinks, SlackMessages, SlackRefusal } from '../slack/ports.js';
import type { SlackApp } from '../slack/slack-app.js';
import type { DoneAtArgo } from './argo-inbox.js';
import { argoSlackMessageOf, doneAtArgoMessageOf } from './argo-slack-message.js';
import type { ArgoSlackPost } from './argo-slack-post.js';
import type { FollowArgoInbox } from './follow-argo-inbox.js';
import type { ArgoAccount, ArgoAccounts, ArgoInboxDoor, ArgoMessage, ArgoMessageRead, ArgoSlackPosts } from './ports.js';

/** One pass over every fleet the gateway is connected to. */
export type ShowArgoInboxInSlack = () => Promise<void>;

type InSlack = SlackApp & { readonly bot: NonNullable<SlackApp['bot']> };

function isInSlack(app: SlackApp | undefined): app is InSlack {
  return app !== undefined && app.bot !== null && app.removedInSlackAt === null;
}

/** Whether Slack may take it later: it rate limited the call or did not answer. */
function isForLater(refusal: SlackRefusal): boolean {
  return refusal.kind !== 'refused';
}

/**
 * Use case: what waits at argo, in Slack (argo's inbox, AI2 to AI4, section
 * 4). For each account allowed as argo, by its latest account token, whose
 * person has Slack linked and turned on for the message's job, each message
 * open at argo is posted once into the person's direct messages through the
 * gateway's own bot, sent since Slack was turned on, as the person's own
 * are. The post is kept before Slack is asked, so a gateway that stops in
 * between posts it at most once more. Once the message is done at argo, by
 * anyone, anywhere, the post is edited to say so, by whom and when, its
 * button gone, and forgotten. The gateway's bot removed in Slack, or Slack
 * refusing a post, drops Slack out for it: Bridge still has it. Slack rate
 * limiting or not answering leaves it for the next pass.
 */
export function createShowArgoInboxInSlack(deps: {
  connections: Pick<ConnectionStore, 'connected'>;
  inboxOf: FollowArgoInbox['inboxOf'];
  doneAtArgo: FollowArgoInbox['doneAtArgo'];
  door: Pick<ArgoInboxDoor, 'entry'>;
  accounts: Pick<ArgoAccounts, 'list'>;
  posts: ArgoSlackPosts;
  links: Pick<SlackLinks, 'ofPersonShip'>;
  apps: Pick<SlackApps, 'gatewayBot' | 'find'>;
  slack: Pick<SlackMessages, 'post' | 'messageOf' | 'update'>;
  routes: Pick<Routes, 'list'>;
  defaults: RoutingDefaults;
  shipNames: ShipNames;
  argoMessageUrlOf: (deliveryId: DeliveryId) => string;
}): ShowArgoInboxInSlack {
  /** Who did it: the name of the person ship of the account signed in as argo, when the gateway keeps it as allowed as argo. */
  const byOf = async (fleetId: FleetId, { done, accounts }: { done: DoneAtArgo | undefined; accounts: readonly ArgoAccount[] }): Promise<string | undefined> => {
    const account = accounts.find(({ accountId }) => accountId === done?.accountId);
    return account === undefined ? undefined : deps.shipNames.nameOf(fleetId, account.personShipId);
  };

  /** Edits a post whose message is done at argo: forgotten once edited, or once there is nothing to edit; kept for the next pass while Slack may take it later. */
  const edit = async (post: ArgoSlackPost, done: { by: string | undefined; at: Date | undefined }): Promise<'forget' | 'keep'> => {
    const app = await deps.apps.find(post.fleetId, post.appId);
    if (post.ts === null || post.isGivenUp || !isInSlack(app)) {
      return 'forget';
    }
    const where = { channel: post.channel, ts: post.ts };
    const message = await deps.slack.messageOf(app.bot.token, { ...where, threadTs: null });
    if (!message.isOk) {
      return isForLater(message.error) ? 'keep' : 'forget';
    }
    const edited = doneAtArgoMessageOf(message.value, done);
    if (edited === undefined) {
      return 'forget';
    }
    const updated = await deps.slack.update(app.bot.token, { ...where, message: edited });
    return !updated.isOk && isForLater(updated.error) ? 'keep' : 'forget';
  };

  /** Posts it: kept with its Slack message, given up once Slack refused it, or left for the next pass. */
  const post = async (bot: InSlack, { kept, read }: { kept: ArgoSlackPost; read: ArgoMessageRead }): Promise<void> => {
    const message = argoSlackMessageOf(read, deps.argoMessageUrlOf(read.deliveryId));
    const posted = await deps.slack.post(bot.bot.token, { messageId: read.messageId, channel: kept.channel, threadTs: null, message });
    if (posted.isOk) {
      await deps.posts.save({ ...kept, ts: posted.value.ts });
    } else if (!isForLater(posted.error)) {
      await deps.posts.save({ ...kept, isGivenUp: true });
    }
  };

  const showIn = async ({ fleetId, crewToken }: { fleetId: FleetId; crewToken: string }): Promise<void> => {
    const inbox = deps.inboxOf(fleetId);
    if (inbox?.kind !== 'read') {
      return;
    }
    const open = new Set(inbox.messages.map(({ messageId }) => messageId));
    const [kept, accounts] = await Promise.all([deps.posts.list(fleetId), deps.accounts.list(fleetId)]);
    for (const each of kept.filter(({ messageId }) => !open.has(messageId))) {
      const done = deps.doneAtArgo(fleetId, each.messageId);
      if ((await edit(each, { by: await byOf(fleetId, { done, accounts }), at: done?.at })) === 'forget') {
        await deps.posts.remove(fleetId, each);
      }
    }
    const bot = await deps.apps.gatewayBot(fleetId);
    if (!isInSlack(bot)) {
      return;
    }
    // Each message is read whole once a pass, for its headline, only when it is to be posted.
    const reads = new Map<MessageId, ArgoMessageRead | null>();
    const readOf = async ({ messageId }: ArgoMessage): Promise<ArgoMessageRead | null> => {
      if (!reads.has(messageId)) {
        const read = await deps.door.entry(crewToken, { argo: inbox.argo, messageId });
        reads.set(messageId, read.isOk ? read.value : null);
      }
      return reads.get(messageId) ?? null;
    };
    for (const { personShipId } of accounts) {
      const link = await deps.links.ofPersonShip(fleetId, personShipId);
      if (link?.stoppedAt !== null) {
        continue;
      }
      const routing = routingOf(await deps.routes.list({ fleetId, shipId: personShipId }), deps.defaults);
      for (const message of inbox.messages) {
        const before = kept.find((each) => each.personShipId === personShipId && each.messageId === message.messageId);
        const isDue = before === undefined ? routing.isShowing('slack', { contentType: message.contentType, sentAt: message.sentAt, senderShipId: message.sender.shipId }) : before.ts === null && !before.isGivenUp;
        const read = isDue ? await readOf(message) : null;
        if (read === null) {
          continue;
        }
        // Kept before Slack is asked: a gateway that stops in between posts it once more, never again.
        const toPost: ArgoSlackPost = before === undefined ? { fleetId, personShipId, messageId: message.messageId, appId: bot.appId, channel: link.slackUserId, ts: null, isGivenUp: false } : { ...before, appId: bot.appId };
        if (before === undefined && (await deps.posts.keep(toPost)) === 'known') {
          continue;
        }
        await post(bot, { kept: toPost, read });
      }
    }
  };

  return async () => {
    for (const crew of await deps.connections.connected()) {
      await showIn(crew);
    }
  };
}
