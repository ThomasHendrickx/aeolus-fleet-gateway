'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { NOTHING_WATCHED, STALE_SHOWN_FOR_MS, nextChangeAtOf, showingOf, watchedOf, type Showing, type WatchedItem } from '../services/leaving-stale';

/** What marks a stale item in the items' text; a delivery id holds none. */
const STALE_MARK = '!';

function itemsOfKey(itemsKey: string): WatchedItem[] {
  return itemsKey === '' ? [] : itemsKey.split(' ').map((each) => ({ deliveryId: each.replace(STALE_MARK, ''), isStale: each.endsWith(STALE_MARK) }));
}

/**
 * How the page shows each item while its asker's withdrawals reach it (#240):
 * a stale one for 5 s from when the page first saw it stale, leaving in the
 * last 300 ms, then gone; one stale before the page read it standing, never.
 * Once one is gone the page reads itself again, so the gateway ends it and
 * every other place drops it too.
 */
export function useLeavingStale(items: readonly WatchedItem[]): (item: WatchedItem) => Showing {
  const router = useRouter();
  const [watch, setWatch] = useState(NOTHING_WATCHED);
  const [atMs, setAtMs] = useState(() => Date.now());
  // The items as text, since their array is new on every render: a new read of the same items watches nothing new.
  const itemsKey = items.map(({ deliveryId, isStale }) => `${deliveryId}${isStale ? STALE_MARK : ''}`).join(' ');
  useEffect(() => {
    const now = Date.now();
    setWatch((watched) => watchedOf(watched, { items: itemsOfKey(itemsKey), atMs: now }));
    setAtMs(now);
  }, [itemsKey]);
  useEffect(() => {
    const nextAt = nextChangeAtOf(watch, atMs);
    if (nextAt === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setAtMs(Date.now());
      if ([...watch.staleSince.values()].some((since) => since + STALE_SHOWN_FOR_MS === nextAt)) {
        router.refresh();
      }
    }, nextAt - Date.now());
    return () => {
      clearTimeout(timer);
    };
  }, [watch, atMs, router]);
  return (item) => showingOf(watch, { item, atMs });
}
