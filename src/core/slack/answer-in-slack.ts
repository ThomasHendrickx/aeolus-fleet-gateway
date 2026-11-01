import { ANSWER_CONTENT_TYPE, questionSchema, type FleetId } from '@aeolus-fleet/common';

import type { ItemOutcomes } from '../people/item-outcome.js';
import { alreadyTextOf } from '../people/opened-of.js';
import { answerKeyOf } from '../people/basket.js';
import { KEY_UNAVAILABLE, SEALED_MESSAGE } from '../people/person-crew.js';
import type { InboxChanges, OpenedDeliveries, PersonCrews, PersonShipDoor } from '../people/ports.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import { editedPostOf } from './edited-post-of.js';
import type { SlackApps, SlackLinks, SlackMessage, SlackMessages, SlackPosts, SlackSignatures } from './ports.js';
import { notSentPostOf, sendingPostOf, type ItemPost } from './pressed-post-of.js';
import { slackPostOf } from './slack-post-of.js';
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
 * keyed as an answer on the gateway's page is; then the delivery is handled
 * and kept answered in Slack (Bridge, CC4). The post shows it as it goes
 * (aeolus-fleet#1573): the option it sends and to whom, its buttons gone;
 * then the answer as views.html draws it; or, when core refused it, why,
 * its buttons back to press again. Slack refusing an edit leaves the post
 * as it is: view sync edits it once the answer is kept. The press names the
 * question's fleet message, as its button carries it, so a press that comes
 * before the gateway kept the post's Slack message is answered too. The
 * press, the person's own act, acknowledges the delivery: Slack posts it
 * without. One answer per question (Bridge, section 9): a question answered
 * in another place first is sent nothing, and the thread says where it was
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
  slack: Pick<SlackMessages, 'update' | 'postInThread'>;
  signatures: SlackSignatures;
  clock: Clock;
  bridgeUrlOf: (fleetId: FleetId) => string;
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
    const bridgeUrl = deps.bridgeUrlOf(app.fleetId);
    const posted = slackPostOf(delivery.value, { bridgeUrl, isHeadedBySender: app.shipId === null });
    // A question too long for Slack is posted as a link, with no item to show it on.
    const shown: ItemPost | undefined = posted.item === null ? undefined : { ...posted, item: posted.item };
    const edit = async (message: SlackMessage | undefined): Promise<void> => {
      if (message !== undefined) {
        await deps.slack.update(app.bot.token, { channel, ts: messageTs, messageId: post.messageId, message });
      }
    };
    await edit(shown && sendingPostOf(shown, option));
    const replied = await deps.door.reply(crew.crewToken, { to: post.senderShipId, inReplyTo: post.messageId, contentType: ANSWER_CONTENT_TYPE, payload: JSON.stringify({ questionId, option }), idempotencyKey: answerKeyOf({ questionId }) });
    if (!replied.isOk) {
      await edit(shown && notSentPostOf(shown, replied.error.message));
      return ok({ kind: 'refused' });
    }
    const at = deps.clock.now();
    await edit(shown && editedPostOf(shown, { outcome: { place: 'slack', kind: 'answered', option, at }, bridgeUrl }));
    const handled = await deps.door.handled(crew.crewToken, post.deliveryId);
    if (handled.isOk) {
      await deps.outcomes.save({ fleetId: app.fleetId, shipId: post.personShipId, deliveryId: post.deliveryId, place: 'slack', kind: 'answered', option, at });
      await deps.opened.remove(app.fleetId, { shipId: post.personShipId, deliveryId: post.deliveryId });
      await deps.changes.tell({ fleetId: app.fleetId, shipId: post.personShipId });
    }
    return ok({ kind: 'answered' });
  };
}
