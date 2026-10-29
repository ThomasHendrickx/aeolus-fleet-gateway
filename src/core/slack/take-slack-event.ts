import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackEvents, SlackLinks, SlackMessages, SlackPosts, SlackSignatures } from './ports.js';
import { isRemovedEvent, personMessageOf, type SlackEventFields } from './slack-event.js';
import { isAwaitingSlackIn } from './slack-post.js';
import { markdownOf } from './slack-markdown.js';
import { isSignedBy } from './slack-request.js';

/** What the gateway answers a person whose disabled account's link stopped (gateway scopes 9.3). */
export const STOPPED_LINK_TEXT = 'Your account cannot message the fleet now';

export type TakeSlackEvent = (event: {
  appId: string;
  event: SlackEventFields;
  /** Whether Slack sends the event again, as it does when no answer came within 3 seconds. */
  isRetry: boolean;
  body: string;
  timestamp: string;
  signature: string;
}) => Promise<Result<{ kind: 'taken' | 'kept' | 'known' | 'notLinked' | 'ignored' }, { kind: 'notSigned' }>>;

/**
 * Use case: an event Slack sends the gateway for one of its apps. It is
 * taken only signed with that app's signing secret, its timestamp within 5
 * minutes of now. An app uninstalled or its tokens revoked is Removed in
 * Slack, its bot token forgotten. A person who messages or mentions a bot
 * unlinked gets an answer only they see, with a button to link, and their
 * message is not stored, since it has no sender yet (gateway scopes 9.3);
 * a disabled account's Slack user is told it cannot message the fleet now.
 * Slack's retry of an event is answered once, the first time. A linked
 * person's message is kept by Slack's event id, as the Markdown it is sent
 * as, and sent now (9.4 step 3); a retry of a kept one changes nothing.
 * One in the thread under a delivery the gateway posted answers it: it goes
 * to that delivery's sender in reply to its message (9.5 step 4). Through
 * the gateway's own bot, only such an answer is sent. One in a thread that
 * matches no post, while a delivery in that conversation is not yet in
 * Slack, may be under it: it is kept, and matched as it is sent.
 */
export function createTakeSlackEvent(deps: {
  apps: Pick<SlackApps, 'findByAppId' | 'save'>;
  links: Pick<SlackLinks, 'find'>;
  events: Pick<SlackEvents, 'keep'>;
  posts: Pick<SlackPosts, 'lastInThread' | 'unfinished'>;
  /** Sends the kept events now, not at the next round. */
  sendNow: () => void;
  slack: Pick<SlackMessages, 'postOnlyTo'>;
  signatures: SlackSignatures;
  clock: Clock;
  /** The web app's page that starts a link, by the fleet named. */
  linkPageUrl: string;
}): TakeSlackEvent {
  return async ({ appId, event, isRetry, body, timestamp, signature }) => {
    const app = await deps.apps.findByAppId(appId);
    const now = deps.clock.now();
    if (!isSignedBy(app, { request: { body, timestamp, signature }, signatures: deps.signatures, clock: deps.clock })) {
      return err({ kind: 'notSigned' });
    }
    if (isRemovedEvent(event)) {
      await deps.apps.save({ ...app, bot: null, removedInSlackAt: now });
      return ok({ kind: 'taken' });
    }
    const message = personMessageOf(event);
    if (message === undefined || app.bot === null) {
      return ok({ kind: 'ignored' });
    }
    const link = await deps.links.find(app.fleetId, { teamId: message.teamId, userId: message.userId });
    if (link?.stoppedAt === null) {
      const { eventId, channel, ts, threadTs, text, files } = message;
      const answered = threadTs === null ? undefined : await deps.posts.lastInThread(app.fleetId, { personShipId: link.personShipId, appId, channel, threadTs });
      const shipId = answered?.senderShipId ?? app.shipId;
      const isToMatch = threadTs !== null && answered === undefined && (await deps.posts.unfinished(app.fleetId, link.personShipId)).some((post) => isAwaitingSlackIn(post, { appId, channel }));
      if (shipId === null && !isToMatch) {
        return ok({ kind: 'ignored' });
      }
      const kept = await deps.events.keep({
        fleetId: app.fleetId,
        eventId,
        appId,
        shipId,
        personShipId: link.personShipId,
        inReplyTo: answered?.messageId ?? null,
        deliveryId: answered?.deliveryId ?? null,
        channel,
        ts,
        threadTs,
        markdown: markdownOf({ text, botUserId: app.bot.userId, files }),
        receivedAt: now,
        takenAt: null,
      });
      if (kept === 'kept') {
        deps.sendNow();
      }
      return ok({ kind: kept });
    }
    if (!isRetry) {
      const answer = link === undefined
        ? { text: `Link your Slack account to talk to ${app.name}. Your message was not kept: send it again once linked.`, button: { text: 'Link Slack', url: `${deps.linkPageUrl}?${new URLSearchParams({ fleet: app.fleetId }).toString()}` } }
        : { text: STOPPED_LINK_TEXT };
      // Slack's refusal leaves nothing to undo: the message was never kept, and the person may write again.
      await deps.slack.postOnlyTo(app.bot.token, { channel: message.channel, user: message.userId, ...answer });
    }
    return ok({ kind: link === undefined ? 'notLinked' : 'ignored' });
  };
}
