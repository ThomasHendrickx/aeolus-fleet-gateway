'use client';

import { ShoppingBasket } from 'lucide-react';

import { staleSaidOf } from '../services/deliveries';
import { seenTextOf, type BridgeHome, type HomeItem } from '../services/items';
import { ActionButton } from '../ui/action-button';
import { ItemRow } from '../ui/item-row';
import { RowLink } from '../ui/row-link';
import { ItemFocus, type ItemOpening } from './item-focus';

function countsOf(items: readonly HomeItem[]): string {
  const counted = items.filter(({ stale }) => stale === null);
  const toDecide = counted.filter(({ job }) => job === 'decide').length;
  const toDo = counted.filter(({ job }) => job === 'do').length;
  return `${String(toDecide)} to decide, ${String(toDo)} to do. Newest on top; nothing else is in this count.`;
}

/** What a row says of its item: stale, in the basket, seen, or nothing while new. */
function rowOutcomeOf(item: HomeItem): string | undefined {
  const { stale, inBasket } = item;
  if (stale === null && inBasket !== null) {
    return inBasket.option === null ? 'In the basket: the note alone' : `In the basket: option ${String(inBasket.option)}`;
  }
  if (stale === null) {
    return item.state === 'seen' ? seenTextOf(item.seenIn) : undefined;
  }
  const said = staleSaidOf(stale, item.from);
  return stale.kind === 'withdrawn' ? `${said}: open it to clear it` : said;
}

/** Opens a replaced question's or step's replacement, the new item, of the same job. */
function ReplacementButton({ item, opening }: { item: HomeItem; opening: ItemOpening }) {
  const replacementId = item.stale?.replacementId ?? null;
  if (replacementId === null) {
    return null;
  }
  return (
    <ActionButton data-testid="bridge-replacement" size="row" isPending={opening.openingId === replacementId} pendingLabel="Opening..." disabled={opening.openingId !== undefined} onClick={() => { opening.open({ deliveryId: replacementId, job: item.job }); }}>
      {item.job === 'do' ? 'Open the new step' : 'Open the new question'}
    </ActionButton>
  );
}

function OpenButton({ item, opening }: { item: HomeItem; opening: ItemOpening }) {
  return (
    <ActionButton data-testid="bridge-open" size="row" isPending={opening.openingId === item.deliveryId} pendingLabel="Opening..." disabled={opening.openingId !== undefined} onClick={() => { opening.open(item); }}>
      Open
    </ActionButton>
  );
}

/**
 * What a row does in place (aeolus-fleet#1535): the asker's pick into the
 * basket, or a step's link by its host, each beside Open; the gateway's own
 * step is its own action alone, where the gateway finishes it.
 */
function WaitingActions({ item, opening }: { item: HomeItem; opening: ItemOpening }) {
  const act = item.actInPlace;
  if (act?.kind === 'ownStep') {
    return (
      <RowLink data-testid="bridge-own-step" href={act.href} isOutside={false}>
        {act.label}
      </RowLink>
    );
  }
  return (
    <>
      {act?.kind === 'putPick' ? (
        <ActionButton data-testid="bridge-put-pick" variant="primary" size="row" isPending={opening.puttingId === item.deliveryId} pendingLabel="Putting..." disabled={opening.openingId !== undefined || opening.puttingId !== undefined} onClick={() => { opening.putPick(item, act.option); }}>
          <ShoppingBasket aria-hidden="true" className="size-3.5" />
          Put option {act.option} in the basket
        </ActionButton>
      ) : null}
      {act?.kind === 'openLink' ? (
        <RowLink data-testid="bridge-step-link" href={act.href} isOutside>
          Open {act.host}
        </RowLink>
      ) : null}
      <ReplacementButton item={item} opening={opening} />
      <OpenButton item={item} opening={opening} />
    </>
  );
}

/** Opens an item from its title, unless one is opening now. */
function openerOf(item: HomeItem, opening: ItemOpening): (() => void) | undefined {
  return opening.openingId === undefined ? () => { opening.open(item); } : undefined;
}

/**
 * Bridge home's lists (CC18): what waits on the person, decide and do, with
 * one count, a dot on what is new, a question or step its asker withdrew or replaced
 * struck through and outside the count, a replaced one leading to its replacement; and the stay-aware feed beside it, the
 * alerts and notices, a dot on those not seen, which alone it counts, outside the count. Opening one of
 * the feed is all it asks (CC16): it stays in the feed, seen.
 */
export function HomePanel({ fleetId, home, now }: { fleetId: string; home: BridgeHome; now: string }) {
  const { waiting, stayAware } = home;
  const readAt = new Date(now);
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
              <ul className="overflow-hidden rounded-lg border border-border bg-card">
                {waiting.items.map((item) => (
                  <ItemRow
                    key={item.deliveryId}
                    item={item}
                    now={readAt}
                    isNew={item.state === 'new'}
                    staleKind={item.stale?.kind}
                    outcome={rowOutcomeOf(item)}
                    failure={opening.failure?.deliveryId === item.deliveryId ? opening.failure.message : undefined}
                    onOpen={openerOf(item, opening)}
                    actions={<WaitingActions item={item} opening={opening} />}
                  />
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-3" aria-labelledby="bridge-stay-aware-heading">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="bridge-stay-aware-heading" className="text-section font-semibold">
                Stay aware
              </h2>
              <span className="text-caption text-muted-foreground">{stayAware.filter(({ state }) => state === 'new').length} unseen, outside the count</span>
            </div>
            {stayAware.length === 0 ? (
              <p data-testid="bridge-nothing-new" className="rounded-md border border-border bg-card p-3 text-muted-foreground">
                Nothing new. What you saw is in Done.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-border bg-card">
                {stayAware.map((item) => (
                  <ItemRow key={item.deliveryId} item={item} now={readAt} isNew={item.state === 'new'} outcome={undefined} failure={opening.failure?.deliveryId === item.deliveryId ? opening.failure.message : undefined} onOpen={openerOf(item, opening)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </ItemFocus>
  );
}
