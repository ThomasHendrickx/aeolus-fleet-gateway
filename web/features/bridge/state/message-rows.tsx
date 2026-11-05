'use client';

import { useState, useTransition } from 'react';

import { doneMessage } from '../hooks/bridge-actions';
import type { BridgeHome } from '../services/items';
import { NOT_MARKED_DONE } from '../services/messages';
import { MessageRow } from '../ui/message-row';
import type { ItemOpening } from './item-focus';

type Message = BridgeHome['messages'][number];

/**
 * Plain messages' rows (#242): Done in place, Marking done... until the fleet
 * answers, then the row leaves the list, or says it was not marked done with
 * Done to try again; Open opens it in focus. Beside an open item, the rows
 * have no buttons and the open one is marked. Home and the Messages page share them.
 */
export function MessageRows({ fleetId, messages, readAt, opening }: { fleetId: string; messages: readonly Message[]; readAt: Date; opening: ItemOpening }) {
  const [markingId, setMarkingId] = useState<string | undefined>();
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<{ deliveryId: string; message: string } | undefined>();
  const [, startTransition] = useTransition();
  const isBeside = opening.opened !== undefined;
  const isBusy = markingId !== undefined || opening.openingId !== undefined;

  const markDone = (message: Message) => {
    setMarkingId(message.deliveryId);
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await doneMessage({ fleet: fleetId, deliveryId: message.deliveryId, isNew: message.state === 'new' });
      setMarkingId(undefined);
      if (outcome.isOk) {
        setDoneIds((done) => new Set([...done, message.deliveryId]));
      } else {
        setFailure({ deliveryId: message.deliveryId, message: outcome.code === undefined ? NOT_MARKED_DONE : `Not marked done: ${outcome.message}` });
      }
    });
  };

  const failureOf = (deliveryId: string): string | undefined => {
    if (failure?.deliveryId === deliveryId) {
      return failure.message;
    }
    return opening.failure?.deliveryId === deliveryId ? opening.failure.message : undefined;
  };

  return (
    <ul className={isBeside ? 'border-t border-border' : 'overflow-hidden rounded-lg border border-border bg-card'}>
      {messages
        .filter(({ deliveryId }) => !doneIds.has(deliveryId))
        .map((message) => (
          <MessageRow
            key={message.deliveryId}
            message={message}
            now={readAt}
            isOpen={opening.opened?.deliveryId === message.deliveryId}
            isMarkingDone={markingId === message.deliveryId}
            isOpening={opening.openingId === message.deliveryId}
            isBusy={isBusy}
            failure={failureOf(message.deliveryId)}
            onDone={isBeside ? undefined : () => { markDone(message); }}
            onOpen={() => { opening.open(message); }}
          />
        ))}
    </ul>
  );
}
