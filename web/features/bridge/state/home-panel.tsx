'use client';

import { Bell, ChevronRight, MessageSquare, ShoppingBasket } from 'lucide-react';
import type { ReactNode } from 'react';

import { useLeavingStale } from '../hooks/use-leaving-stale';
import { inFleet } from '../../../lib/gateway-api/page-account';
import { BRIDGE_MESSAGES_PATH } from '../paths';
import { staleSaidOf } from '../services/deliveries';
import { seenTextOf, type BridgeHome, type HomeItem } from '../services/items';
import { lastReadTimeOf } from '../services/last-read';
import type { WatchedItem } from '../services/leaving-stale';
import { HOME_MESSAGES, messagesSaidOf, showAllSaidOf } from '../services/messages';
import type { RoutedPlace } from '../services/routing';
import { ActionButton } from '../ui/action-button';
import { ItemRow } from '../ui/item-row';
import { RowLink } from '../ui/row-link';
import { ItemFocus, type ItemOpening } from './item-focus';
import { MessageRows } from './message-rows';
import { useLastReadAt } from './kept-read';

/** What a row says of its item: stale, in the basket, seen, or nothing while new. A stale one clears itself (#240). */
function rowOutcomeOf(item: HomeItem): string | undefined {
  const { stale, inBasket } = item;
  if (stale === null && inBasket !== null) {
    return inBasket.option === null ? 'In the basket: the note alone' : `In the basket: option ${String(inBasket.option)}`;
  }
  if (stale === null) {
    return item.state === 'seen' ? seenTextOf(item.seenIn) : undefined;
  }
  return staleSaidOf(stale, { from: item.from });
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

/** The rows of what waits: each with its actions while the list is shown alone, without them beside an open item, the open one marked. */
function WaitingRows({ items, readAt, opening, leaving }: { items: readonly HomeItem[]; readAt: Date; opening: ItemOpening; leaving: ReadonlySet<string> }) {
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
          isLeaving={leaving.has(item.deliveryId)}
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
function ListBeside({ home, readAt, opening, leaving }: { home: BridgeHome; readAt: Date; opening: ItemOpening & { opened: NonNullable<ItemOpening['opened']> }; leaving: ReadonlySet<string> }) {
  const { waiting, stayAware } = home;
  return opening.opened.job === 'stay-aware' ? (
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
      <WaitingRows items={waiting.items} readAt={readAt} opening={opening} leaving={leaving} />
    </section>
  );
}

/**
 * Bridge home's lists (CC18): what waits on the person, decide and do, with
 * one count, a dot on what is new, a question or step its asker withdrew or replaced
 * struck through and outside the count, a replaced one leading to its replacement; and the stay-aware feed beside it, the
 * alerts and notices, a dot on those not seen, which alone it counts, outside the count. Opening one of
 * the feed is all it asks (CC16): it stays in the feed, seen. The count heads the page, above Your fleet
 * too (HomeHeading). The plain messages beneath what waits, outside the count, the 3 newest closed
 * by a link to all of them; one opens on the Messages page (#242).
 * Beside an open item, only the list it was opened from (aeolus-fleet#1538).
 */
export function HomeLists({ fleetId, home, now, opening, argo, leaving = new Set() }: { fleetId: string; home: BridgeHome; now: string; opening: ItemOpening; argo?: ReactNode; /** The stale rows leaving now, in their last 300 ms (#240). */ leaving?: ReadonlySet<string> }) {
  const { waiting, stayAware, messages } = home;
  const readAt = new Date(now);
  const { opened } = opening;
  if (opened !== undefined) {
    return <ListBeside home={home} readAt={readAt} opening={{ ...opening, opened }} leaving={leaving} />;
  }
  const newMessages = messages.filter(({ state }) => state === 'new').length;
  return (
    <div className="grid gap-8">
      <section className="grid gap-3" aria-labelledby="bridge-waiting-heading">
        {waiting.items.length === 0 ? (
          <div data-testid="bridge-nothing-waits" className="grid justify-items-center gap-1 rounded-lg border border-border bg-card p-6 text-center">
            <span className="font-semibold">Nothing waits on you</span>
            <span className="text-muted-foreground">Your ships have what they need from you. A question or a step shows here the moment one arrives.</span>
          </div>
        ) : (
          <WaitingRows items={waiting.items} readAt={readAt} opening={opening} leaving={leaving} />
        )}
      </section>
      {messages.length === 0 ? null : (
        <section className="grid gap-3" aria-labelledby="bridge-messages-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="bridge-messages-heading" className="inline-flex items-center gap-2 text-section font-semibold">
              <MessageSquare aria-hidden="true" className="size-4 shrink-0" />
              Messages
            </h2>
            <span className="text-caption text-muted-foreground">{messagesSaidOf(newMessages)}</span>
          </div>
          <MessageRows fleetId={fleetId} messages={messages.slice(0, HOME_MESSAGES)} readAt={readAt} opening={opening} isOpenedOnPage />
          {messages.length > HOME_MESSAGES ? (
            <a data-testid="bridge-all-messages" href={inFleet(BRIDGE_MESSAGES_PATH, fleetId)} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card font-medium text-primary hover:bg-accent">
              {showAllSaidOf(messages.length)}
              <ChevronRight aria-hidden="true" className="size-4" />
            </a>
          ) : null}
        </section>
      )}
      {argo}
      <section className="grid gap-3" aria-labelledby="bridge-stay-aware-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="bridge-stay-aware-heading" className="inline-flex items-center gap-2 text-section font-semibold">
            <Bell aria-hidden="true" className="size-4 shrink-0" />
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

/** An item as the page watches its asker's withdrawals. */
function watchedItemOf({ deliveryId, stale }: HomeItem): WatchedItem {
  return { deliveryId, isStale: stale !== null };
}

/** Bridge home: its lists, with one item in focus at a time, a stale one leaving 5 s after its withdrawal reached the page (#240), and argo's section below what waits on the person, for an account allowed as argo; as last read, what waited then. */
export function HomePanel({ fleetId, home, now, decidePlaces, argo }: { fleetId: string; home: BridgeHome; now: string; decidePlaces?: readonly RoutedPlace[]; argo?: ReactNode }) {
  const lastReadAt = useLastReadAt();
  const showingOf = useLeavingStale(home.waiting.items.map(watchedItemOf));
  if (lastReadAt !== undefined) {
    return <WaitingAsLastRead items={home.waiting.items} lastReadAt={lastReadAt} />;
  }
  const items = home.waiting.items.filter((item) => showingOf(watchedItemOf(item)) !== 'gone');
  const leaving = new Set(items.filter((item) => showingOf(watchedItemOf(item)) === 'leaving').map(({ deliveryId }) => deliveryId));
  const shown = { ...home, waiting: { ...home.waiting, items } };
  return (
    <ItemFocus fleetId={fleetId} decidePlaces={decidePlaces} known={[...items, ...home.stayAware]}>
      {(opening) => <HomeLists fleetId={fleetId} home={shown} now={now} opening={opening} argo={argo} leaving={leaving} />}
    </ItemFocus>
  );
}
