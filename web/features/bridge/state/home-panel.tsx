'use client';

import { Send, ShoppingBasket } from 'lucide-react';
import type { ReactNode } from 'react';

import { staleSaidOf } from '../services/deliveries';
import { seenTextOf, type BridgeHome, type HomeItem } from '../services/items';
import { lastReadTimeOf } from '../services/last-read';
import type { RoutedPlace } from '../services/routing';
import { ActionButton } from '../ui/action-button';
import { ItemRow } from '../ui/item-row';
import { RowLink } from '../ui/row-link';
import { ItemFocus, type ItemOpening } from './item-focus';
import { useLastReadAt } from './kept-read';
import { useSendMessage } from './send-message';

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
  const said = staleSaidOf(stale, { from: item.from });
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

/** Opens the form to send any ship a message (aeolus-fleet #1547): its words on the desktop, its icon alone on the phone. */
function SendMessageButton() {
  const sendMessage = useSendMessage();
  if (sendMessage === undefined) {
    return null;
  }
  return (
    <button type="button" data-testid="bridge-send-message" aria-label="Send a ship a message" onClick={() => { sendMessage(); }} className="inline-flex size-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-card font-semibold hover:bg-accent sm:w-auto sm:px-4">
      <Send aria-hidden="true" className="size-4" />
      <span className="hidden sm:inline">Send a ship a message</span>
    </button>
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

/** The rows of what waits: each with its actions while the list is shown alone, without them beside an open item, the open one marked. */
function WaitingRows({ items, readAt, opening }: { items: readonly HomeItem[]; readAt: Date; opening: ItemOpening }) {
  const isBeside = opening.opened !== undefined;
  return (
    <ul className={isBeside ? 'border-t border-border' : 'overflow-hidden rounded-lg border border-border bg-card'}>
      {items.map((item) => (
        <ItemRow
          key={item.deliveryId}
          item={item}
          now={readAt}
          isNew={item.state === 'new'}
          isOpen={opening.opened?.deliveryId === item.deliveryId}
          staleKind={item.stale?.kind}
          outcome={rowOutcomeOf(item)}
          failure={opening.failure?.deliveryId === item.deliveryId ? opening.failure.message : undefined}
          onOpen={openerOf(item, opening)}
          actions={isBeside ? undefined : <WaitingActions item={item} opening={opening} />}
        />
      ))}
    </ul>
  );
}

/** The stay-aware feed's rows, a dot on those not seen; home and the Stay aware page share them. */
export function StayAwareRows({ items, readAt, opening }: { items: readonly HomeItem[]; readAt: Date; opening: ItemOpening }) {
  return (
    <ul className={opening.opened === undefined ? 'overflow-hidden rounded-lg border border-border bg-card' : 'border-t border-border'}>
      {items.map((item) => (
        <ItemRow key={item.deliveryId} item={item} now={readAt} isNew={item.state === 'new'} isOpen={opening.opened?.deliveryId === item.deliveryId} outcome={undefined} failure={opening.failure?.deliveryId === item.deliveryId ? opening.failure.message : undefined} onOpen={openerOf(item, opening)} />
      ))}
    </ul>
  );
}

/**
 * The list beside an open item (decide.html, stay-aware.html): the one it
 * was opened from, headed with its count, its rows without their buttons;
 * pressing a title opens that item in its place.
 */
function ListBeside({ home, readAt, opening, isStayAware }: { home: BridgeHome; readAt: Date; opening: ItemOpening; isStayAware: boolean }) {
  const { waiting, stayAware } = home;
  return isStayAware ? (
    <section aria-labelledby="bridge-stay-aware-heading">
      <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
        <h2 id="bridge-stay-aware-heading" className="font-semibold">
          Stay aware
        </h2>
        <span className="text-caption text-muted-foreground">{stayAware.filter(({ state }) => state === 'new').length} unseen</span>
      </div>
      <StayAwareRows items={stayAware} readAt={readAt} opening={opening} />
    </section>
  ) : (
    <section aria-labelledby="bridge-waiting-heading">
      <h1 id="bridge-waiting-heading" className="px-3 py-2.5 font-semibold">
        Waiting on you <span data-testid="bridge-count" className="text-tone-waiting-fg">{waiting.count}</span>
      </h1>
      <WaitingRows items={waiting.items} readAt={readAt} opening={opening} />
    </section>
  );
}

/**
 * Bridge home's lists (CC18): what waits on the person, decide and do, with
 * one count, a dot on what is new, a question or step its asker withdrew or replaced
 * struck through and outside the count, a replaced one leading to its replacement; and the stay-aware feed beside it, the
 * alerts and notices, a dot on those not seen, which alone it counts, outside the count. Opening one of
 * the feed is all it asks (CC16): it stays in the feed, seen. Beside the count, the person sends any
 * ship a message. Beside an open item, only the list it was opened from (aeolus-fleet#1538).
 */
export function HomeLists({ home, now, opening, argo }: { home: BridgeHome; now: string; opening: ItemOpening; argo?: ReactNode }) {
  const { waiting, stayAware } = home;
  const readAt = new Date(now);
  if (opening.opened !== undefined) {
    return <ListBeside home={home} readAt={readAt} opening={opening} isStayAware={opening.opened.job === 'stay-aware'} />;
  }
  return (
    <div className="grid gap-8">
      <section className="grid gap-3" aria-labelledby="bridge-waiting-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 id="bridge-waiting-heading" className="text-heading font-semibold">
              Waiting on you <span data-testid="bridge-count" className="text-tone-waiting-fg">{waiting.count}</span>
            </h1>
            <p className="text-muted-foreground">{waiting.count === 0 ? 'Nothing waits on you.' : countsOf(waiting.items)}</p>
          </div>
          <SendMessageButton />
        </div>
        {waiting.items.length === 0 ? (
          <div data-testid="bridge-nothing-waits" className="grid justify-items-center gap-1 rounded-lg border border-border bg-card p-6 text-center">
            <span className="font-semibold">Nothing waits on you</span>
            <span className="text-muted-foreground">Your ships have what they need from you. A question or a step shows here the moment one arrives.</span>
          </div>
        ) : (
          <WaitingRows items={waiting.items} readAt={readAt} opening={opening} />
        )}
      </section>
      {argo}
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
          <StayAwareRows items={stayAware} readAt={readAt} opening={opening} />
        )}
      </section>
    </div>
  );
}

/**
 * What waited when Bridge home was last read, while the record cannot be
 * read (states.html): the rows faded and not to be opened, since opening
 * one acknowledges it through the fleet, and that they show as last read.
 * The stay-aware feed and sending a message wait for the fleet.
 */
function WaitingAsLastRead({ items, lastReadAt }: { items: readonly HomeItem[]; lastReadAt: string }) {
  const readAt = new Date(lastReadAt);
  return (
    <section className="grid gap-3" aria-label="Waiting on you, as last read">
      {items.length === 0 ? null : (
        <ul inert className="overflow-hidden rounded-lg border border-border bg-card opacity-60">
          {items.map((item) => (
            <ItemRow key={item.deliveryId} item={item} now={readAt} isNew={item.state === 'new'} isOpen={false} staleKind={item.stale?.kind} outcome={rowOutcomeOf(item)} failure={undefined} onOpen={undefined} />
          ))}
        </ul>
      )}
      <p className="text-caption text-muted-foreground">{`Shown as last read, at ${lastReadTimeOf(lastReadAt)}.`}</p>
    </section>
  );
}

/** Bridge home: its lists, with one item in focus at a time, and argo's section below what waits on the person, for an account allowed as argo; as last read, what waited then. */
export function HomePanel({ fleetId, home, now, decidePlaces, argo }: { fleetId: string; home: BridgeHome; now: string; decidePlaces?: readonly RoutedPlace[]; argo?: ReactNode }) {
  const lastReadAt = useLastReadAt();
  if (lastReadAt !== undefined) {
    return <WaitingAsLastRead items={home.waiting.items} lastReadAt={lastReadAt} />;
  }
  return (
    <ItemFocus fleetId={fleetId} decidePlaces={decidePlaces}>
      {(opening) => <HomeLists home={home} now={now} opening={opening} argo={argo} />}
    </ItemFocus>
  );
}
