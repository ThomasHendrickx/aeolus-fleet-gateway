'use client';

import type { HomeItem } from '../services/items';
import { StayAwareRows } from './home-panel';
import { ItemFocus } from './item-focus';

/**
 * Stay aware (stay-aware.html): the alerts and notices that reached the
 * person, a dot on those not seen, with the unseen count, outside what
 * waits. Opening one is all it asks (CC16). Slice 7 of aeolus-fleet#1533
 * draws the page whole.
 */
export function StayAwarePanel({ fleetId, stayAware, now }: { fleetId: string; stayAware: readonly HomeItem[]; now: string }) {
  return (
    <ItemFocus fleetId={fleetId}>
      {(opening) => (
        <section className="grid gap-3" aria-labelledby="bridge-stay-aware-heading">
          <div>
            <h1 id="bridge-stay-aware-heading" className="text-heading font-semibold">
              Stay aware
            </h1>
            <p data-testid="bridge-stay-aware-count" className="text-muted-foreground">
              {stayAware.filter(({ state }) => state === 'new').length} unseen, outside the count
            </p>
          </div>
          {stayAware.length === 0 ? (
            <p data-testid="bridge-nothing-new" className="rounded-md border border-border bg-card p-3 text-muted-foreground">
              Nothing new. What you saw is in Done.
            </p>
          ) : (
            <StayAwareRows items={stayAware} readAt={new Date(now)} opening={opening} />
          )}
        </section>
      )}
    </ItemFocus>
  );
}
