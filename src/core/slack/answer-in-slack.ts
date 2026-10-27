import { ANSWER_CONTENT_TYPE, questionSchema } from '@aeolus-fleet/common';

import type { PersonCrews, PersonShipDoor } from '../people/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackLinks, SlackMessages, SlackPosts, SlackSignatures } from './ports.js';
import { isSignedBy, type SignedRequest } from './slack-request.js';
import { STORED_REACTION } from './send-slack-events.js';

export type AnswerInSlack = (press: SignedRequest & { appId: string; teamId: string; userId: string; channel: string; messageTs: string; option: number }) => Promise<Result<{ kind: 'answered' | 'refused' | 'ignored' }, { kind: 'notSigned' }>>;

/** The question's id in a delivery's payload; none when it is no question. */
function questionIdOf(payload: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    return questionSchema.safeParse(parsed).data?.id;
  } catch {
    return undefined;
  }
}

/**
 * Use case: the person presses an option's button under a question the
 * gateway posted to them in Slack (gateway scopes 9.5 step 2). Signed as an
 * event is, by the person the question was posted to, the press sends the
 * answer as their person ship, to the question's sender in reply to it,
 * keyed as an answer on the gateway's page is; then the delivery is handled
 * and the question reacted to, as a message core stored is. Core's refusal
 * is said in the question's thread.
 */
export function createAnswerInSlack(deps: {
  apps: Pick<SlackApps, 'findByAppId'>;
  links: Pick<SlackLinks, 'find'>;
  posts: Pick<SlackPosts, 'atSlackMessage'>;
  crews: Pick<PersonCrews, 'find'>;
  door: Pick<PersonShipDoor, 'delivery' | 'reply' | 'handled'>;
  slack: Pick<SlackMessages, 'react' | 'postInThread'>;
  signatures: SlackSignatures;
  clock: Clock;
}): AnswerInSlack {
  return async ({ appId, teamId, userId, channel, messageTs, option, body, timestamp, signature }) => {
    const app = await deps.apps.findByAppId(appId);
    if (!isSignedBy(app, { request: { body, timestamp, signature }, signatures: deps.signatures, clock: deps.clock })) {
      return err({ kind: 'notSigned' });
    }
    const link = await deps.links.find(app.fleetId, { teamId, userId });
    const post = link?.stoppedAt === null ? await deps.posts.atSlackMessage(app.fleetId, { personShipId: link.personShipId, appId, channel, ts: messageTs }) : undefined;
    const crew = post === undefined ? undefined : await deps.crews.find(app.fleetId, post.personShipId);
    if (post === undefined || post.deliveryId === null || post.senderShipId === null || crew === undefined || app.bot === null) {
      return ok({ kind: 'ignored' });
    }
    const delivery = await deps.door.delivery(crew.crewToken, post.deliveryId);
    const questionId = delivery.isOk ? questionIdOf(delivery.value.payload) : undefined;
    if (!delivery.isOk || questionId === undefined) {
      return ok({ kind: 'ignored' });
    }
    const replied = await deps.door.reply(crew.crewToken, { to: post.senderShipId, inReplyTo: post.messageId, contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId, option }), idempotencyKey: `answer-${post.deliveryId}` });
    if (!replied.isOk) {
      await deps.slack.postInThread(app.bot.token, { channel, threadTs: messageTs, text: `${delivery.value.senderName} did not take your answer: ${replied.error.message}` });
      return ok({ kind: 'refused' });
    }
    await deps.door.handled(crew.crewToken, post.deliveryId);
    await deps.slack.react(app.bot.token, { channel, ts: messageTs, name: STORED_REACTION });
    return ok({ kind: 'answered' });
  };
}
