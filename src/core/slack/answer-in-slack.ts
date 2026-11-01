import { ANSWER_CONTENT_TYPE, questionSchema } from '@aeolus-fleet/common';

import type { ItemOutcomes } from '../people/item-outcome.js';
import { alreadyTextOf } from '../people/opened-of.js';
import { answerKeyOf } from '../people/basket.js';
import { KEY_UNAVAILABLE, SEALED_MESSAGE } from '../people/person-crew.js';
import type { InboxChanges, OpenedDeliveries, PersonCrews, PersonShipDoor } from '../people/ports.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackLinks, SlackMessages, SlackPosts, SlackSignatures } from './ports.js';
import { STORED_REACTION } from './send-slack-events.js';
import { pressedOf, type SlackPress } from './slack-press.js';

export type AnswerInSlack = (press: SlackPress & { option: number }) => Promise<Result<{ kind: 'answered' | 'answeredElsewhere' | 'refused' | 'ignored' }, { kind: 'notSigned' }>>;

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
 * keyed as an answer on the gateway's page is; then the delivery is handled,
 * kept answered in Slack (Bridge, CC4), and the question reacted to, as a message core stored is. Core's refusal
 * is said in the question's thread. The press names the question's fleet
 * message, as its button carries it, so a press that comes before the
 * gateway kept the post's Slack message is answered too. The press, the
 * person's own act, acknowledges the delivery: Slack posts it without.
 * One answer per question (Bridge, section 9): a question answered in
 * another place first is sent nothing, and the thread says where it was
 * answered; the answer is keyed by the question's uuid, as the basket's is,
 * so two presses at once in two places are stored once. Once handled, the
 * question is no longer opened anywhere, and every page of the person is
 * told, so Bridge and a chat show it answered in Slack (view sync).
 */
export function createAnswerInSlack(deps: {
  apps: Pick<SlackApps, 'findByAppId'>;
  links: Pick<SlackLinks, 'find'>;
  posts: Pick<SlackPosts, 'ofMessage'>;
  crews: Pick<PersonCrews, 'find'>;
  door: Pick<PersonShipDoor, 'ack' | 'delivery' | 'reply' | 'handled'>;
  outcomes: ItemOutcomes;
  opened: Pick<OpenedDeliveries, 'remove'>;
  changes: InboxChanges;
  slack: Pick<SlackMessages, 'react' | 'postInThread'>;
  signatures: SlackSignatures;
  clock: Clock;
}): AnswerInSlack {
  return async (press) => {
    const { channel, messageTs, option } = press;
    const pressed = await pressedOf(deps, press);
    if (!pressed.isOk) {
      return pressed;
    }
    if (pressed.value === undefined) {
      return ok({ kind: 'ignored' });
    }
    const { app, post, crew } = pressed.value;
    const [earlier] = await deps.outcomes.findMany(app.fleetId, { shipId: post.personShipId, deliveryIds: [post.deliveryId] });
    if (earlier !== undefined) {
      await deps.slack.postInThread(app.bot.token, { channel, threadTs: messageTs, text: alreadyTextOf(earlier) });
      return ok({ kind: 'answeredElsewhere' });
    }
    // The press, the person's own act, acknowledges it (Bridge, CC6); core reads a delivery again only once acknowledged, so a refusal leaves it unread, and the press ignored.
    await deps.door.ack(crew.crewToken, post.deliveryId);
    const delivery = await deps.door.delivery(crew.crewToken, post.deliveryId);
    if (!delivery.isOk && delivery.error.code === KEY_UNAVAILABLE) {
      await deps.slack.postInThread(app.bot.token, { channel, threadTs: messageTs, text: SEALED_MESSAGE });
      return ok({ kind: 'refused' });
    }
    const questionId = delivery.isOk ? questionIdOf(delivery.value.payload) : undefined;
    if (!delivery.isOk || questionId === undefined) {
      return ok({ kind: 'ignored' });
    }
    const replied = await deps.door.reply(crew.crewToken, { to: post.senderShipId, inReplyTo: post.messageId, contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId, option }), idempotencyKey: answerKeyOf({ questionId }) });
    if (!replied.isOk) {
      await deps.slack.postInThread(app.bot.token, { channel, threadTs: messageTs, text: `${delivery.value.senderName} did not take your answer: ${replied.error.message}` });
      return ok({ kind: 'refused' });
    }
    const handled = await deps.door.handled(crew.crewToken, post.deliveryId);
    if (handled.isOk) {
      await deps.outcomes.save({ fleetId: app.fleetId, shipId: post.personShipId, deliveryId: post.deliveryId, place: 'slack', kind: 'answered', option, at: deps.clock.now() });
      await deps.opened.remove(app.fleetId, { shipId: post.personShipId, deliveryId: post.deliveryId });
      await deps.changes.tell({ fleetId: app.fleetId, shipId: post.personShipId });
    }
    await deps.slack.react(app.bot.token, { channel, ts: messageTs, name: STORED_REACTION });
    return ok({ kind: 'answered' });
  };
}
