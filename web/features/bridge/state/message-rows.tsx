'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { doneMessage } from '../hooks/bridge-actions';
import type { BridgeHome } from '../services/items';
import { messageAddressOf, notMarkedDoneOf } from '../services/messages';
import { MessageRow } from '../ui/message-row';
import type { ItemOpening } from './item-focus';

type Message = BridgeHome['messages'][number];

/**
 * Plain messages' rows (#242): Done in place, Marking done... until the fleet
 * answers, then the row leaves the list, or says it was not marked done with
 * Done to try again; Open opens it in focus, or from home on the Messages
 * page, which opens it there. Beside an open item, the rows
 * have no buttons and the open one is marked. Home and the Messages page share them.
 */
export function MessageRows({ fleetId, messages, readAt, opening, isOpenedOnPage = false }: { fleetId: string; messages: readonly Message[]; readAt: Date; opening: ItemOpening; /** Whether Open leads to the Messages page, which opens it there (home). */ isOpenedOnPage?: boolean }) {
  const router = useRouter();
  const [markingId, setMarkingId] = useState<string | undefined>();
  const [goingId, setGoingId] = useState<string | undefined>();
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<{ deliveryId: string; message: string } | undefined>();
  const [, startTransition] = useTransition();
  const isBeside = opening.opened !== undefined;
  const openingId = goingId ?? opening.openingId;
  const isBusy = markingId !== undefined || openingId !== undefined;

  const open = (message: Message) => {
    if (!isOpenedOnPage) {
      opening.open(message);
      return;
    }
    setGoingId(message.deliveryId);
    startTransition(() => {
      router.push(messageAddressOf({ fleetId, deliveryId: message.deliveryId }));
    });
  };

  const markDone = (message: Message) => {
    setMarkingId(message.deliveryId);
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await doneMessage({ fleet: fleetId, deliveryId: message.deliveryId, isNew: message.state === 'new' });
      setMarkingId(undefined);
      if (outcome.isOk) {
        setDoneIds((done) => new Set([...done, message.deliveryId]));
      } else {
        setFailure({ deliveryId: message.deliveryId, message: notMarkedDoneOf(outcome.code === undefined ? undefined : outcome.message) });
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
            isOpening={openingId === message.deliveryId}
            isBusy={isBusy}
            failure={failureOf(message.deliveryId)}
            onDone={isBeside ? undefined : () => { markDone(message); }}
            onOpen={() => { open(message); }}
          />
        ))}
    </ul>
  );
}
