/**
 * What core answers for a ship's exchange calls (aeolus-fleet
 * docs/design/exchange-read, core main), read at the edge. The published
 * @aeolus-fleet/common does not carry these schemas yet; once a core release
 * does, they come from it and this file goes.
 */
import { deliveryStateSchema, idSchema, shipKindSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

export const exchangeOutputSchema = z.object({
  items: z.array(
    z.object({
      messageId: idSchema('message'),
      senderShipId: idSchema('ship'),
      payload: z.string(),
      isPayloadUnreadable: z.boolean(),
      contentType: z.string(),
      inReplyTo: idSchema('message').nullable(),
      sentAt: z.iso.datetime(),
      deliveryState: deliveryStateSchema.nullable(),
      receivedDelivery: z.object({ deliveryId: idSchema('delivery'), state: deliveryStateSchema }).nullable(),
    }),
  ),
  olderCursor: idSchema('delivery').nullable(),
  newerCursor: idSchema('delivery').nullable(),
});

export const exchangesOutputSchema = z.object({
  items: z.array(
    z.object({
      otherShipId: idSchema('ship'),
      otherShipName: z.string(),
      otherShipType: z.string(),
      otherShipKind: shipKindSchema,
      unacknowledged: z.int().min(0),
      newestMessage: z.object({
        messageId: idSchema('message'),
        senderShipId: idSchema('ship'),
        payload: z.string(),
        isPayloadUnreadable: z.boolean(),
        contentType: z.string(),
        sentAt: z.iso.datetime(),
      }),
    }),
  ),
  nextCursor: idSchema('message').nullable(),
});

export const ackUpToOutputSchema = z.object({ acknowledged: z.int().min(0) });
