'use client';

import { CircleCheck, CircleX } from 'lucide-react';
import { useState, useSyncExternalStore, useTransition } from 'react';

import { readMoreRecord } from '../hooks/bridge-actions';
import { clockTimeOf, dayOf, doneOutcomeOf, type RecordItem, type RecordPage } from '../services/items';
import { ActionButton } from '../ui/action-button';
import { DoneCard } from '../ui/done-card';
import { ItemRow } from '../ui/item-row';
import { ItemSplit } from '../ui/item-split';
import { Notice } from '../ui/notice';

/** The time zone a page is read in on the server, before the browser says its own. */
const SERVER_TIME_ZONE = 'UTC';

function unchanging(): () => void {
  return () => undefined;
}

/** The person's own time zone, the browser's; the server's until the page runs there, so the first render matches it. */
function useTimeZone(): string {
  return useSyncExternalStore(unchanging, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => SERVER_TIME_ZONE);
}

/** The items in their order, a run per day they arrived on. */
function byDay(items: readonly RecordItem[], of: { now: Date; timeZone: string }): { day: string; items: RecordItem[] }[] {
  const days: { day: string; items: RecordItem[] }[] = [];
  for (const item of items) {
    const day = dayOf(item.sentAt, of);
    const last = days.at(-1);
    if (last?.day === day) {
      last.items.push(item);
    } else {
      days.push({ day, items: [item] });
    }
  }
  return days;
}

/** What came of an item on its row, on a line of its own, its icon saying whether it ended well (done.html). */
function DoneOutcome({ item }: { item: RecordItem }) {
  const outcome = doneOutcomeOf(item);
  const Icon = outcome.isOk ? CircleCheck : CircleX;
  return (
    <span data-testid="bridge-done-outcome" className="flex items-start gap-1.5 text-caption">
      <Icon aria-hidden="true" className={`mt-0.5 size-3.5 shrink-0 ${outcome.isOk ? 'text-tone-ok-fg' : 'text-muted-foreground'}`} />
      {outcome.text}
    </span>
  );
}

/**
 * Done (Bridge, CC4; done.html): everything done that reached the person,
 * newest first, under the day it arrived, each with the time of day, the
 * places that showed it and what came of it and where. Its title opens it,
 * read back whole beside the list, with nothing acknowledged. The next page
 * is read only when they ask for it.
 */
export function DonePanel({ fleetId, first, now }: { fleetId: string; first: RecordPage; now: string }) {
  const readAt = new Date(now);
  const timeZone = useTimeZone();
  const [items, setItems] = useState(first.items);
  const [nextCursor, setNextCursor] = useState(first.nextCursor);
  const [failure, setFailure] = useState<string | undefined>();
  const [openId, setOpenId] = useState<string | undefined>();
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

  const open = items.find(({ deliveryId }) => deliveryId === openId);
  return (
    <ItemSplit
      list={
        <section className="grid gap-3" aria-labelledby="bridge-done-heading">
          <div className={open === undefined ? '' : 'md:px-3 md:pt-3'}>
            <h1 id="bridge-done-heading" className="text-heading font-semibold">
              Done
            </h1>
            <p className="text-muted-foreground">Everything that reached you, with what came of it and where. Opening one reads it back whole.</p>
          </div>
          {items.length === 0 ? (
            <p data-testid="bridge-record-empty" className="rounded-md border border-border bg-card p-3 text-muted-foreground">
              Nothing is done yet.
            </p>
          ) : (
            byDay(items, { now: readAt, timeZone }).map(({ day, items: ofDay }) => (
              <div key={day} className="grid gap-1.5">
                <h2 className="text-caption text-muted-foreground">{day}</h2>
                <ul className="overflow-hidden rounded-lg border border-border bg-card">
                  {ofDay.map((item) => (
                    <ItemRow
                      key={item.deliveryId}
                      item={item}
                      now={readAt}
                      isNew={false}
                      isOpen={item.deliveryId === openId}
                      outcome={undefined}
                      failure={undefined}
                      time={clockTimeOf(item.sentAt, timeZone)}
                      detail={<DoneOutcome item={item} />}
                      onOpen={() => { setOpenId(item.deliveryId); }}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
          {failure === undefined ? null : <Notice message={failure} isFailure />}
          {nextCursor === null ? null : (
            <ActionButton data-testid="bridge-more" className="justify-self-start" isPending={isReading} pendingLabel="Reading..." onClick={() => { readMore(nextCursor); }}>
              Show older
            </ActionButton>
          )}
        </section>
      }
      item={open === undefined ? undefined : <DoneCard item={open} timeZone={timeZone} bridgeHost={window.location.host} onBack={() => { setOpenId(undefined); }} />}
    />
  );
}
