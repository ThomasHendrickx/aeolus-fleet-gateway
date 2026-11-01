'use client';

import type { HomeItem } from '../services/items';
import { ActionButton } from '../ui/action-button';
import { ItemRow } from '../ui/item-row';
import { ItemFocus } from './item-focus';

/**
 * Stay aware (stay-aware.html): the alerts and notices that reached the
 * person and they have not seen, with their count, outside what waits.
 * Opening one is all it asks (CC16). Slice 7 of aeolus-fleet#1533 draws
 * the page whole.
 */
export function StayAwarePanel({ fleetId, stayAware }: { fleetId: string; stayAware: readonly HomeItem[] }) {
  return (
    <ItemFocus fleetId={fleetId}>
      {(opening) => (
        <section className="grid gap-3" aria-labelledby="bridge-stay-aware-heading">
          <div>
            <h1 id="bridge-stay-aware-heading" className="text-heading font-semibold">
              Stay aware
            </h1>
            <p data-testid="bridge-stay-aware-count" className="text-muted-foreground">
              {stayAware.length} unseen, outside the count
            </p>
          </div>
          {stayAware.length === 0 ? (
            <p data-testid="bridge-nothing-new" className="rounded-md border border-border bg-card p-3 text-muted-foreground">
              Nothing new. What you saw is in Done.
            </p>
          ) : (
            <ul className="grid gap-2">
              {stayAware.map((item) => (
                <ItemRow key={item.deliveryId} item={item} isNew outcome={undefined} failure={opening.failure?.deliveryId === item.deliveryId ? opening.failure.message : undefined}>
                  <ActionButton data-testid="bridge-open" isPending={opening.openingId === item.deliveryId} pendingLabel="Opening..." disabled={opening.openingId !== undefined} onClick={() => { opening.open(item); }}>
                    Open
                  </ActionButton>
                </ItemRow>
              ))}
            </ul>
          )}
        </section>
      )}
    </ItemFocus>
  );
}
