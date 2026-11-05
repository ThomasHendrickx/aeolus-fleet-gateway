/**
 * A withdrawn or replaced item leaves Bridge's overview 5 s after its
 * withdrawal reached the open page (#240, design/bridge-withdrawn-leaves):
 * struck through from 0 s, leaving in the last 300 ms (the design system's
 * slow duration), gone at 5 s. The page counts from when it first saw the
 * item stale, so a late withdrawal still shows for 5 s; one already stale
 * when the page first read it reached no open Bridge, and never shows.
 */

/** How long a stale item shows after its withdrawal reached the page. */
export const STALE_SHOWN_FOR_MS = 5000;
/** How long a stale item takes to leave, at the end of the time it shows: the design system's slow duration. */
export const LEAVING_FOR_MS = 300;

/** What the page watched of its items: those it read standing, and when it first saw each stale. */
export interface StaleWatch {
  readonly standing: ReadonlySet<string>;
  readonly staleSince: ReadonlyMap<string, number>;
}

/** An item as the watch needs it: its delivery, and whether its asker withdrew or replaced it. */
export interface WatchedItem {
  readonly deliveryId: string;
  readonly isStale: boolean;
}

export type Showing = 'shown' | 'leaving' | 'gone';

export const NOTHING_WATCHED: StaleWatch = { standing: new Set(), staleSince: new Map() };

/** The watch once the page read these items at this time: each standing one kept, each stale one it read standing timed from its first sight. */
export function watchedOf(watch: StaleWatch, read: { items: readonly WatchedItem[]; atMs: number }): StaleWatch {
  const { items, atMs } = read;
  const standing = new Set(watch.standing);
  const staleSince = new Map(watch.staleSince);
  for (const { deliveryId, isStale } of items) {
    if (!isStale) {
      standing.add(deliveryId);
    } else if (standing.has(deliveryId) && !staleSince.has(deliveryId)) {
      staleSince.set(deliveryId, atMs);
    }
  }
  return { standing, staleSince };
}

/** How the page shows an item at this time: a standing one shown; a stale one shown, then leaving, then gone; one stale before the page read it standing, gone. */
export function showingOf(watch: StaleWatch, at: { item: WatchedItem; atMs: number }): Showing {
  const { item, atMs } = at;
  if (!item.isStale) {
    return 'shown';
  }
  const since = watch.staleSince.get(item.deliveryId);
  if (since === undefined) {
    return watch.standing.has(item.deliveryId) ? 'shown' : 'gone';
  }
  const shownForMs = atMs - since;
  if (shownForMs >= STALE_SHOWN_FOR_MS) {
    return 'gone';
  }
  return shownForMs >= STALE_SHOWN_FOR_MS - LEAVING_FOR_MS ? 'leaving' : 'shown';
}

/** When the next stale item starts leaving or is gone, after this time; none while nothing more changes. */
export function nextChangeAtOf(watch: StaleWatch, atMs: number): number | undefined {
  const changes = [...watch.staleSince.values()].flatMap((since) => [since + STALE_SHOWN_FOR_MS - LEAVING_FOR_MS, since + STALE_SHOWN_FOR_MS]).filter((at) => at > atMs);
  return changes.length === 0 ? undefined : Math.min(...changes);
}
