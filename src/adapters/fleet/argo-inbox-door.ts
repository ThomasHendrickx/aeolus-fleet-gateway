/**
 * argo's inbox as the gateway's own ship reads it through core's public
 * ship contract, by its crew token and within its read reach (argo's inbox,
 * AI9; decision 0034): argo by fleet.list, the fleet's events by
 * fleet.follow, with who caused each change, and argo's messages by
 * fleet.shipMessages and, read whole with their payloads, fleet.message,
 * which have no REST door, so they go over tRPC with the crew token.
 */
import { FOLLOW_MAX_LIMIT, FOLLOW_WAIT_MAX_SECONDS, followFleetOutputSchema, messageOutputSchema, shipMessagesOutputSchema, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';
import type { z } from 'zod';

import type { ArgoInboxDoor, ArgoInboxListed } from '../../core/argo-inbox/ports.js';
import type { FleetRefusal } from '../../core/connection/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';
import { readAs } from './actor-door.js';
import { everyListedShip } from './every-listed-ship.js';
import { questionPartsOf } from './rest-fleet-door.js';

/** The code tRPC answers for a message the fleet does not show the reader: none, or one outside its read reach (core's MESSAGE_NOT_FOUND). */
const MESSAGE_NOT_FOUND = 'NOT_FOUND';

type ListedMessage = z.infer<typeof shipMessagesOutputSchema>['items'][number];

/** What fleet.shipMessages and fleet.message both answer of a message. */
interface Listed extends Pick<ListedMessage, 'id' | 'sender' | 'recipient' | 'contentType' | 'sentAt'> {
  delivery: Pick<ListedMessage['delivery'], 'id' | 'state'>;
}

/** A message as the fleet lists it, when it is one to argo. */
function listedOf(argo: ShipId, { id, sender, recipient, contentType, sentAt, delivery }: Listed): ArgoInboxListed | null {
  if (recipient.kind !== 'ship' || recipient.ship.id !== argo) {
    return null;
  }
  return { messageId: id, deliveryId: delivery.id, sender: { shipId: sender.id, name: sender.name }, contentType, sentAt: new Date(sentAt), deliveryState: delivery.state };
}

function parsedAs<T>(schema: z.ZodType<T>, read: Result<unknown, FleetRefusal>): Result<T, FleetRefusal> {
  if (!read.isOk) {
    return read;
  }
  const parsed = schema.safeParse(read.value);
  return parsed.success ? ok(parsed.data) : err({ code: 'UNAVAILABLE', message: 'The fleet answered what the gateway cannot read' });
}

export function createArgoInboxDoor(options: { fleetUrl: string }): ArgoInboxDoor {
  const { fleetUrl } = options;
  return {
    argoInReach: async (crewToken) => {
      const listed = await everyListedShip(fleetUrl, { as: { crewToken }, filter: { shipKind: ['operator'] } });
      return listed.isOk ? ok(listed.value.find(({ kind }) => kind === 'operator')?.id ?? null) : listed;
    },
    position: async (crewToken) => {
      const followed = parsedAs(followFleetOutputSchema, await readAs(fleetUrl, { as: { crewToken }, procedure: 'follow', input: {} }));
      return followed.isOk ? ok(followed.value.lastSeq) : followed;
    },
    entries: async (crewToken, argo) => {
      const entries: ArgoInboxListed[] = [];
      let cursor: MessageId | null = null;
      do {
        const input: { shipId: ShipId; limit: number; cursor?: MessageId } = { shipId: argo, limit: PAGE_SIZE_MAX, ...(cursor === null ? {} : { cursor }) };
        const page = parsedAs(shipMessagesOutputSchema, await readAs(fleetUrl, { as: { crewToken }, procedure: 'shipMessages', input, isTrpcOnly: true }));
        if (!page.isOk) {
          return page;
        }
        entries.push(...page.value.items.flatMap((listed) => listedOf(argo, listed) ?? []));
        cursor = page.value.nextCursor;
      } while (cursor !== null);
      return ok(entries);
    },
    entry: async (crewToken, { argo, messageId }) => {
      const read = parsedAs(messageOutputSchema, await readAs(fleetUrl, { as: { crewToken }, procedure: 'message', input: { messageId }, isTrpcOnly: true }));
      if (!read.isOk) {
        return read.error.code === MESSAGE_NOT_FOUND ? ok(null) : read;
      }
      const listed = listedOf(argo, read.value);
      const { contentType, payload } = read.value;
      return ok(listed === null ? null : { ...listed, payload, ...questionPartsOf({ contentType, payload }) });
    },
    changes: async (crewToken, { argo, afterSeq, signal }) => {
      const input = { afterSeq, max: FOLLOW_MAX_LIMIT, waitSeconds: FOLLOW_WAIT_MAX_SECONDS };
      const followed = parsedAs(followFleetOutputSchema, await readAs(fleetUrl, { as: { crewToken }, procedure: 'follow', input, signal }));
      if (!followed.isOk) {
        return followed;
      }
      const changes = followed.value.events.flatMap(({ shipId, messageId, occurredAt, actorShipId, actorSignedInAccountId }) =>
        shipId === argo && messageId !== null ? [{ messageId, occurredAt: new Date(occurredAt), actorShipId, signedInAccountId: actorSignedInAccountId }] : [],
      );
      return ok({ changes, lastSeq: followed.value.lastSeq });
    },
  };
}
