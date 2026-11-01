import type { ItemOutcomes } from '../people/item-outcome.js';
import { jobOf } from '../people/item-job.js';
import { KEY_UNAVAILABLE, SEALED_MESSAGE } from '../people/person-crew.js';
import type { InboxChanges, OpenedDeliveries, PersonCrews, PersonShipDoor } from '../people/ports.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { SlackApps, SlackLinks, SlackMessages, SlackPosts, SlackSignatures } from './ports.js';
import { pressedOf, type SlackPress } from './slack-press.js';

export type SeeInSlack = (press: SlackPress) => Promise<Result<{ kind: 'seen' | 'refused' | 'ignored' }, { kind: 'notSigned' }>>;

/**
 * Use case: the person presses Seen under an item the gateway posted to
 * them in Slack with no other button (Bridge, section 6). The press, the
 * person's first action, acknowledges the delivery (CC6). Seeing an alert
 * or a notice is all it asks: it is reported handled too (CC16), and no
 * longer opened anywhere. It is kept seen in Slack, once the fleet took it,
 * and every page of the person is told, so Bridge shows where it was seen
 * and the post is edited to say so (view sync). A press the fleet did not
 * take changes nothing, so a press again tries once more.
 */
export function createSeeInSlack(deps: {
  apps: Pick<SlackApps, 'findByAppId'>;
  links: Pick<SlackLinks, 'find'>;
  posts: Pick<SlackPosts, 'ofMessage'>;
  crews: Pick<PersonCrews, 'find'>;
  door: Pick<PersonShipDoor, 'ack' | 'delivery' | 'handled'>;
  outcomes: Pick<ItemOutcomes, 'save'>;
  opened: Pick<OpenedDeliveries, 'remove'>;
  changes: InboxChanges;
  slack: Pick<SlackMessages, 'postInThread'>;
  signatures: SlackSignatures;
  clock: Clock;
}): SeeInSlack {
  return async (press) => {
    const pressed = await pressedOf(deps, press);
    if (!pressed.isOk) {
      return pressed;
    }
    if (pressed.value === undefined) {
      return ok({ kind: 'ignored' });
    }
    const { app, post, crew } = pressed.value;
    const { fleetId, personShipId: shipId, deliveryId } = post;
    // Core reads a delivery again only once acknowledged: the read names its job.
    await deps.door.ack(crew.crewToken, deliveryId);
    const delivery = await deps.door.delivery(crew.crewToken, deliveryId);
    if (!delivery.isOk) {
      if (delivery.error.code === KEY_UNAVAILABLE) {
        await deps.slack.postInThread(app.bot.token, { channel: press.channel, threadTs: press.messageTs, text: SEALED_MESSAGE });
        return ok({ kind: 'refused' });
      }
      return ok({ kind: 'ignored' });
    }
    if (jobOf(delivery.value.contentType) === 'stay-aware') {
      const handled = await deps.door.handled(crew.crewToken, deliveryId);
      if (!handled.isOk) {
        return ok({ kind: 'refused' });
      }
      await deps.opened.remove(fleetId, { shipId, deliveryId });
    }
    await deps.outcomes.save({ fleetId, shipId, deliveryId, place: 'slack', kind: 'seen', option: null, at: deps.clock.now() });
    await deps.changes.tell({ fleetId, shipId });
    return ok({ kind: 'seen' });
  };
}
