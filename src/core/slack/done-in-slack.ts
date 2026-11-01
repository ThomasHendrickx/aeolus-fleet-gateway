import type { ItemOutcomes } from '../people/item-outcome.js';
import { alreadyTextOf } from '../people/opened-of.js';
import { KEY_UNAVAILABLE, SEALED_MESSAGE } from '../people/person-crew.js';
import type { InboxChanges, OpenedDeliveries, PersonCrews, PersonShipDoor } from '../people/ports.js';
import { STEP_OUTCOME_CONTENT_TYPE, stepOutcomePayloadOf } from '../people/step-outcome.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackLinks, SlackMessages, SlackPosts, SlackSignatures } from './ports.js';
import { STORED_REACTION } from './send-slack-events.js';
import { pressedOf, type SlackPress } from './slack-press.js';

export type DoneInSlack = (press: SlackPress) => Promise<Result<{ kind: 'done' | 'doneElsewhere' | 'refused' | 'ignored' }, { kind: 'notSigned' }>>;

/**
 * Use case: the person presses Done under a step the gateway posted to them
 * in Slack (Bridge, section 9, #1514). Signed as an event is, by the person
 * the step was posted to, the press, their own act, acknowledges it (CC6)
 * and sends the step's outcome done as their person ship, to its asker in
 * reply to it, at once and without a note (CC23), keyed as Bridge's Done is,
 * so a step done in both is sent once. Then the delivery is handled, kept
 * done in Slack (CC4), no longer opened anywhere, every page of the person
 * told, and the step reacted to, as a message core stored is. A step another
 * place ended first is sent nothing, and its thread says where; the fleet's
 * refusal is said there too, and leaves it undone.
 */
export function createDoneInSlack(deps: {
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
}): DoneInSlack {
  return async (press) => {
    const { channel, messageTs } = press;
    const pressed = await pressedOf(deps, press);
    if (!pressed.isOk) {
      return pressed;
    }
    if (pressed.value === undefined) {
      return ok({ kind: 'ignored' });
    }
    const { app, post, crew } = pressed.value;
    const { fleetId, personShipId: shipId, deliveryId } = post;
    const inThread = (text: string) => deps.slack.postInThread(app.bot.token, { channel, threadTs: messageTs, text });
    const [earlier] = await deps.outcomes.findMany(fleetId, { shipId, deliveryIds: [deliveryId] });
    if (earlier !== undefined) {
      await inThread(alreadyTextOf(earlier));
      return ok({ kind: 'doneElsewhere' });
    }
    // Core reads a delivery again only once acknowledged: the read names the step.
    await deps.door.ack(crew.crewToken, deliveryId);
    const delivery = await deps.door.delivery(crew.crewToken, deliveryId);
    if (!delivery.isOk && delivery.error.code === KEY_UNAVAILABLE) {
      await inThread(SEALED_MESSAGE);
      return ok({ kind: 'refused' });
    }
    if (!delivery.isOk || delivery.value.stepId === null) {
      return ok({ kind: 'ignored' });
    }
    const outcome = { to: post.senderShipId, inReplyTo: post.messageId, contentType: STEP_OUTCOME_CONTENT_TYPE, payload: stepOutcomePayloadOf({ stepId: delivery.value.stepId, kind: 'done', note: null }), idempotencyKey: `step-outcome-${deliveryId}` };
    const replied = await deps.door.reply(crew.crewToken, outcome);
    if (!replied.isOk) {
      await inThread(`${delivery.value.senderName} did not take your outcome: ${replied.error.message}`);
      return ok({ kind: 'refused' });
    }
    const handled = await deps.door.handled(crew.crewToken, deliveryId);
    if (handled.isOk) {
      await deps.outcomes.save({ fleetId, shipId, deliveryId, place: 'slack', kind: 'done', option: null, at: deps.clock.now() });
      await deps.opened.remove(fleetId, { shipId, deliveryId });
      await deps.changes.tell({ fleetId, shipId });
    }
    await deps.slack.react(app.bot.token, { channel, ts: messageTs, name: STORED_REACTION });
    return ok({ kind: 'done' });
  };
}
