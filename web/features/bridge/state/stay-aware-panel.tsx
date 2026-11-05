'use client';

import type { HomeItem } from '../services/items';
import { unseenSaidOf } from '../services/stay-aware';
import { StayAwareRows } from './home-panel';
import { ItemFocus } from './item-focus';

/**
 * Stay aware (stay-aware.html): the alerts and notices that reached the
 * person, outside what waits, a dot on those not seen, with how many they
 * have not seen; the seen ones are those on the record's newest page, as
 * Bridge home reads them. Opening one is all it asks (CC16); an alert opens
 * with its ship's Health in the fleet's console. On the phone the top bar
 * names the page and the Aware tab its count.
 */
export function StayAwarePanel({ fleetId, consoleUrl, stayAware, now }: { fleetId: string; consoleUrl: string | undefined; stayAware: readonly HomeItem[]; now: string }) {
  return (
    <ItemFocus fleetId={fleetId} consoleUrl={consoleUrl} known={stayAware}>
      {(opening) => (
        <section className="grid gap-3" aria-labelledby="bridge-stay-aware-heading">
          <div className={`flex items-baseline justify-between gap-3 max-sm:sr-only ${opening.opened === undefined ? '' : 'px-3 pt-2.5'}`}>
            <h1 id="bridge-stay-aware-heading" className={opening.opened === undefined ? 'text-heading font-semibold' : 'font-semibold'}>
              Stay aware
            </h1>
            <span data-testid="bridge-stay-aware-count" className="text-caption text-muted-foreground">
              {unseenSaidOf(stayAware.filter(({ state }) => state === 'new').length)}
            </span>
          </div>
          <p className="text-caption text-muted-foreground sm:hidden">Not in the count. Seeing one is all it asks.</p>
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
