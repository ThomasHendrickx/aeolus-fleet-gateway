'use client';

import type { HomeItem, RecordItem } from '../services/items';
import { feedOf, unseenSaidOf } from '../services/stay-aware';
import { ActionButton } from '../ui/action-button';
import { ItemRow } from '../ui/item-row';
import { ItemFocus } from './item-focus';

/**
 * Stay aware (stay-aware.html): the alerts and notices that reached the
 * person, outside what waits, with how many they have not seen. Opening one
 * is all it asks (CC16): it is done, so the seen ones come from the record's
 * newest page, after it, with nothing more to open; older ones are in Done.
 */
export function StayAwarePanel({ fleetId, consoleUrl, unseen, record }: { fleetId: string; consoleUrl: string | undefined; unseen: readonly HomeItem[]; record: readonly RecordItem[] }) {
  const feed = feedOf({ unseen, record });
  return (
    <ItemFocus fleetId={fleetId} consoleUrl={consoleUrl}>
      {(opening) => (
        <section className="grid gap-3" aria-labelledby="bridge-stay-aware-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h1 id="bridge-stay-aware-heading" className="text-heading font-semibold">
              Stay aware
            </h1>
            <span data-testid="bridge-stay-aware-count" className="text-caption text-muted-foreground">
              {unseenSaidOf(unseen.length)}
            </span>
          </div>
          <p className="text-caption text-muted-foreground md:hidden">Not in the count. Seeing one is all it asks.</p>
          {feed.length === 0 ? (
            <p data-testid="bridge-nothing-new" className="rounded-md border border-border bg-card p-3 text-muted-foreground">
              Nothing new. What you saw earlier is in Done.
            </p>
          ) : (
            <ul className="grid gap-2">
              {feed.map(({ item, isNew }) => (
                <ItemRow key={item.deliveryId} item={item} isNew={isNew} outcome={undefined} failure={opening.failure?.deliveryId === item.deliveryId ? opening.failure.message : undefined}>
                  {isNew ? (
                    <ActionButton data-testid="bridge-open" isPending={opening.openingId === item.deliveryId} pendingLabel="Opening..." disabled={opening.openingId !== undefined} onClick={() => { opening.open(item); }}>
                      Open
                    </ActionButton>
                  ) : null}
                </ItemRow>
              ))}
            </ul>
          )}
        </section>
      )}
    </ItemFocus>
  );
}
