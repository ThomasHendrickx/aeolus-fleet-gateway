'use client';

import { useState, useTransition } from 'react';

import { readMoreRecord } from '../hooks/bridge-actions';
import { outcomeTextOf, type RecordPage } from '../services/items';
import { ActionButton } from '../ui/action-button';
import { ItemRow } from '../ui/item-row';
import { Notice } from '../ui/notice';
import { ItemFocus } from './item-focus';

/**
 * Done (Bridge, CC4): everything that reached the person, newest first, with
 * what came of it and where. The next page is read only when they ask for
 * it. One not done yet opens here, to answer or be done with.
 */
export function DonePanel({ fleetId, first }: { fleetId: string; first: RecordPage }) {
  const [items, setItems] = useState(first.items);
  const [nextCursor, setNextCursor] = useState(first.nextCursor);
  const [failure, setFailure] = useState<string | undefined>();
  const [isReading, startTransition] = useTransition();

  const readMore = (cursor: string) => {
    setFailure(undefined);
    startTransition(async () => {
      const more = await readMoreRecord(fleetId, cursor);
      if (more.isOk) {
        setItems((shown) => [...shown, ...more.value.items]);
        setNextCursor(more.value.nextCursor);
      } else {
        setFailure(more.message);
      }
    });
  };

  return (
    <ItemFocus fleetId={fleetId}>
      {(opening) => (
        <section className="grid gap-3" aria-labelledby="bridge-done-heading">
          <div>
            <h1 id="bridge-done-heading" className="text-heading font-semibold">
              Done
            </h1>
            <p className="text-muted-foreground">Everything that reached you, with what came of it and where.</p>
          </div>
          {items.length === 0 ? (
            <p data-testid="bridge-record-empty" className="rounded-md border border-border bg-card p-3 text-muted-foreground">
              Nothing has reached you yet.
            </p>
          ) : (
            <ul className="grid gap-2">
              {items.map((item) => (
                <ItemRow key={item.deliveryId} item={item} isNew={item.state === 'new'} outcome={outcomeTextOf(item)} failure={opening.failure?.deliveryId === item.deliveryId ? opening.failure.message : undefined}>
                  {item.state === 'done' ? null : (
                    <ActionButton data-testid="bridge-open" isPending={opening.openingId === item.deliveryId} pendingLabel="Opening..." disabled={opening.openingId !== undefined} onClick={() => { opening.open(item); }}>
                      Open
                    </ActionButton>
                  )}
                </ItemRow>
              ))}
            </ul>
          )}
          {failure === undefined ? null : <Notice message={failure} isFailure />}
          {nextCursor === null ? null : (
            <ActionButton data-testid="bridge-more" className="justify-self-start" isPending={isReading} pendingLabel="Reading..." onClick={() => { readMore(nextCursor); }}>
              Show older
            </ActionButton>
          )}
        </section>
      )}
    </ItemFocus>
  );
}
