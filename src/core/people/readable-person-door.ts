/** Returns malformed questions and steps before confirming them, and hides stored ones on every person read. */
import type { DeliveryId, MessageId } from '@aeolus-fleet/common';

import { err, ok } from '../shared/result.js';
import type { Clock } from '../shared/clock.js';
import { isUnreadableOpenedItem } from './unreadable-opened-item.js';
import type { OpenedDeliveries, PersonDelivery, PersonShipDoor } from './ports.js';
import type { UnreadableReplies } from './unreadable-replies.js';
import { unreadableItem } from './unreadable-item.js';

export function createReadablePersonDoor(door: PersonShipDoor, deps: { opened: OpenedDeliveries; replies: UnreadableReplies; clock: Clock; refusedReply?: (refusal: { deliveryId: DeliveryId; code: string; message: string }) => void }): PersonShipDoor {
  const missing = (deliveryId: DeliveryId) => err({ code: 'DELIVERY_NOT_FOUND', message: `Delivery ${deliveryId} cannot be read` });
  const returnToSender = async (crewToken: string, { delivery, reason }: { delivery: PersonDelivery; reason: string }) => {
    const sent = await door.reply(crewToken, {
      to: delivery.senderShipId,
      inReplyTo: delivery.messageId,
      contentType: 'text/plain',
      payload: `Your question or step could not be read. Please correct it and send it again.\n\n${reason}`,
      idempotencyKey: `unreadable-${delivery.deliveryId}`,
    });
    const shouldRetry = !sent.isOk && sent.error.code !== 'NOT_FOUND' && sent.error.code !== 'FORBIDDEN';
    if (!sent.isOk && !shouldRetry) {
      deps.refusedReply?.({ deliveryId: delivery.deliveryId, ...sent.error });
    }
    const who = await door.whoami(crewToken);
    if (!who.isOk) {
      return who;
    }
    if (sent.isOk) {
      await deps.replies.save(who.value.fleetId, { shipId: who.value.shipId, messageId: sent.value.messageId });
    }
    await deps.opened.save({
      fleetId: who.value.fleetId, shipId: who.value.shipId,
      deliveryId: delivery.deliveryId, messageId: delivery.messageId,
      senderShipId: delivery.senderShipId, from: delivery.senderName,
      title: 'Unreadable question or step', contentType: delivery.contentType,
      askedQuestionId: null, withdrawnQuestionId: null, stepId: null,
      withdrawnStepId: null, stepLink: null, openedIn: null,
      sentAt: delivery.sentAt, openedAt: deps.clock.now(),
    });
    const acknowledged = await door.ack(crewToken, delivery.deliveryId);
    if (!acknowledged.isOk) {
      return acknowledged;
    }
    if (shouldRetry) {
      return ok(true);
    }
    const handled = await door.handled(crewToken, delivery.deliveryId);
    if (handled.isOk) {
      await deps.opened.remove(who.value.fleetId, { shipId: who.value.shipId, deliveryId: delivery.deliveryId });
    }
    return handled.isOk ? ok(true) : handled;
  };
  const hiddenReplies = async (crewToken: string, messageIds: readonly MessageId[]) => {
    const who = await door.whoami(crewToken);
    return who.isOk
      ? ok(await deps.replies.among(who.value.fleetId, { shipId: who.value.shipId, messageIds }))
      : who;
  };
  const recover = async (crewToken: string) => {
    // Saved before ack: an acknowledged delivery survives a crash before handled.
    const who = await door.whoami(crewToken);
    if (!who.isOk) {
      return who;
    }
    const opened = await deps.opened.list(who.value.fleetId, who.value.shipId);
    for (const pending of opened.filter(isUnreadableOpenedItem)) {
      const delivery = await door.delivery(crewToken, pending.deliveryId);
      if (delivery.isOk) {
        const reason = unreadableItem(delivery.value);
        if (reason !== null) {
          const returned = await returnToSender(crewToken, { delivery: delivery.value, reason });
          if (!returned.isOk) {
            return returned;
          }
        }
      } else if (delivery.error.code === 'DELIVERY_NOT_FOUND') {
        // Handling may have succeeded before the gateway stopped removing its saved item.
        const handled = await door.handled(crewToken, pending.deliveryId);
        if (handled.isOk) {
          await deps.opened.remove(pending.fleetId, pending);
        } else if (handled.error.code !== 'DELIVERY_NOT_ACKNOWLEDGED') {
          return handled;
        }
      } else if (delivery.error.code !== 'DELIVERY_NOT_ACKNOWLEDGED') {
        return delivery;
      }
    }
    return ok(undefined);
  };
  return {
    ...door,
    inbox: async (crewToken, wait) => {
      const recovered = await recover(crewToken);
      return recovered.isOk ? door.inbox(crewToken, wait) : recovered;
    },
    pushReceive: async (crewToken, take) => {
      const recovered = await recover(crewToken);
      if (!recovered.isOk) {
        return recovered;
      }
      let received = await door.pushReceive(crewToken, take);
      while (received.isOk) {
        for (const delivery of received.value) {
          const reason = unreadableItem(delivery);
          if (reason !== null) {
            const returned = await returnToSender(crewToken, { delivery, reason });
            if (!returned.isOk) {
              return returned;
            }
          }
        }
        const readable = received.value.filter((delivery) => unreadableItem(delivery) === null);
        if (readable.length > 0 || received.value.length === 0) {
          return ok(readable);
        }
        // All were returned and acknowledged: reach past them instead of hiding the next valid page.
        received = await door.pushReceive(crewToken, take);
      }
      return received;
    },
    delivery: async (crewToken, deliveryId) => {
      const read = await door.delivery(crewToken, deliveryId);
      if (!read.isOk) {
        return read;
      }
      const hidden = await hiddenReplies(crewToken, [read.value.messageId]);
      if (!hidden.isOk) {
        return hidden;
      }
      if (hidden.value.has(read.value.messageId)) {
        return missing(deliveryId);
      }
      const reason = unreadableItem(read.value);
      if (reason === null) {
        return read;
      }
      const returned = await returnToSender(crewToken, { delivery: read.value, reason });
      return returned.isOk ? missing(deliveryId) : returned;
    },
    record: async (crewToken, page) => {
      const read = await door.record(crewToken, page);
      if (!read.isOk) {
        return read;
      }
      const hidden = await hiddenReplies(crewToken, read.value.items.map(({ messageId }) => messageId));
      return hidden.isOk ? ok({ ...read.value, items: read.value.items.filter((delivery) => !hidden.value.has(delivery.messageId) && unreadableItem(delivery) === null) }) : hidden;
    },
    exchange: async (crewToken, page) => {
      const read = await door.exchange(crewToken, page);
      if (!read.isOk) {
        return read;
      }
      const hidden = await hiddenReplies(crewToken, read.value.items.map(({ messageId }) => messageId));
      return hidden.isOk ? ok({ ...read.value, items: read.value.items.filter((message) => !hidden.value.has(message.messageId) && unreadableItem(message) === null) }) : hidden;
    },
    exchanges: async (crewToken, page) => {
      const read = await door.exchanges(crewToken, page);
      if (!read.isOk) {
        return read;
      }
      const hidden = await hiddenReplies(crewToken, read.value.items.map(({ newestMessage }) => newestMessage.messageId));
      return hidden.isOk ? ok({ ...read.value, items: read.value.items.filter(({ newestMessage }) => !hidden.value.has(newestMessage.messageId) && unreadableItem(newestMessage) === null) }) : hidden;
    },
  };
}
