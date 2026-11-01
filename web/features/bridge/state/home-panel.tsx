'use client';

import type { BridgeHome, HomeItem } from '../services/items';
import { ActionButton } from '../ui/action-button';
import { ItemRow } from '../ui/item-row';
import { ItemFocus, type ItemOpening } from './item-focus';

function countsOf(items: readonly HomeItem[]): string {
  const counted = items.filter(({ stale }) => stale === null);
  const toDecide = counted.filter(({ job }) => job === 'decide').length;
  const toDo = counted.filter(({ job }) => job === 'do').length;
  return `${String(toDecide)} to decide, ${String(toDo)} to do. Newest on top; nothing else is in this count.`;
}

/** What a row says of its item: stale, in the basket, seen and not done, or nothing while new. */
function rowOutcomeOf(item: HomeItem, items: readonly HomeItem[]): string | undefined {
  const { stale, inBasket } = item;
  if (stale === null && inBasket !== null) {
    return `In the basket: option ${String(inBasket.option)}`;
  }
  if (stale === null) {
    return item.state === 'seen' ? 'Seen, not done yet' : undefined;
  }
  if (stale.kind === 'withdrawn') {
    return `Withdrawn by ${item.from}: open it to clear it`;
  }
  const replacement = items.find(({ deliveryId }) => deliveryId === stale.replacementId);
  return replacement === undefined ? `Replaced by ${item.from}` : `Replaced by ${item.from} with “${replacement.title}”`;
}

/** Opens a replaced question's replacement, the new item. */
function ReplacementButton({ item, opening }: { item: HomeItem; opening: ItemOpening }) {
  const replacementId = item.stale?.replacementId ?? null;
  if (replacementId === null) {
    return null;
  }
  return (
    <ActionButton data-testid="bridge-replacement" isPending={opening.openingId === replacementId} pendingLabel="Opening..." disabled={opening.openingId !== undefined} onClick={() => { opening.open({ deliveryId: replacementId, job: 'decide' }); }}>
      Open the new question
    </ActionButton>
  );
}

function OpenButton({ item, opening }: { item: HomeItem; opening: ItemOpening }) {
  return (
    <ActionButton data-testid="bridge-open" isPending={opening.openingId === item.deliveryId} pendingLabel="Opening..." disabled={opening.openingId !== undefined} onClick={() => { opening.open(item); }}>
      Open
    </ActionButton>
  );
}

/**
 * Bridge home's lists (CC18): what waits on the person, decide and do, with
 * one count, a dot on what is new, a question its asker withdrew or replaced
 * faded and outside the count, a replaced one leading to its replacement; and the stay-aware feed beside it, the
 * alerts and notices they have not seen, outside the count. Opening one of
 * the feed is all it asks (CC16).
 */
export function HomePanel({ fleetId, home }: { fleetId: string; home: BridgeHome }) {
  const { waiting, stayAware } = home;
  return (
    <ItemFocus fleetId={fleetId}>
      {(opening) => (
        <div className="grid gap-8">
          <section className="grid gap-3" aria-labelledby="bridge-waiting-heading">
            <div>
              <h1 id="bridge-waiting-heading" className="text-heading font-semibold">
                Waiting on you <span data-testid="bridge-count" className="text-tone-waiting-fg">{waiting.count}</span>
              </h1>
              <p className="text-muted-foreground">{waiting.count === 0 ? 'Nothing waits on you.' : countsOf(waiting.items)}</p>
            </div>
            {waiting.items.length === 0 ? (
              <div data-testid="bridge-nothing-waits" className="grid justify-items-center gap-1 rounded-lg border border-border bg-card p-6 text-center">
                <span className="font-semibold">Nothing waits on you</span>
                <span className="text-muted-foreground">Your ships have what they need from you. A question or a step shows here the moment one arrives.</span>
              </div>
            ) : (
              <ul className="grid gap-2">
                {waiting.items.map((item) => (
                  <ItemRow key={item.deliveryId} item={item} isNew={item.state === 'new'} isStale={item.stale !== null} outcome={rowOutcomeOf(item, waiting.items)} failure={opening.failure?.deliveryId === item.deliveryId ? opening.failure.message : undefined}>
                    <ReplacementButton item={item} opening={opening} />
                    <OpenButton item={item} opening={opening} />
                  </ItemRow>
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-3" aria-labelledby="bridge-stay-aware-heading">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="bridge-stay-aware-heading" className="text-section font-semibold">
                Stay aware
              </h2>
              <span className="text-caption text-muted-foreground">{stayAware.length} unseen, outside the count</span>
            </div>
            {stayAware.length === 0 ? (
              <p data-testid="bridge-nothing-new" className="rounded-md border border-border bg-card p-3 text-muted-foreground">
                Nothing new. What you saw is in Done.
              </p>
            ) : (
              <ul className="grid gap-2">
                {stayAware.map((item) => (
                  <ItemRow key={item.deliveryId} item={item} isNew outcome={undefined} failure={opening.failure?.deliveryId === item.deliveryId ? opening.failure.message : undefined}>
                    <OpenButton item={item} opening={opening} />
                  </ItemRow>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </ItemFocus>
  );
}
