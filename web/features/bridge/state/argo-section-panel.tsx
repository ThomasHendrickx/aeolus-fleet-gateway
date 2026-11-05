'use client';

import { useLeavingStale } from '../hooks/use-leaving-stale';
import type { ArgoSection } from '../services/argo-section';
import type { WatchedItem } from '../services/leaving-stale';
import { ArgoSectionList } from '../ui/argo-section';

function watchedItemOf({ deliveryId, stale }: ArgoSection['items'][number]): WatchedItem {
  return { deliveryId, isStale: stale !== null };
}

/**
 * Bridge's argo section as the page shows it: argo's items follow the
 * person's rule (#240), a withdrawn or replaced one leaving 5 s after its
 * withdrawal reached the page and never shown when Bridge was not open then.
 * It leaves Bridge's view only: argo's inbox in the console keeps it.
 */
export function ArgoSectionPanel({ section, now }: { section: ArgoSection; now: string }) {
  const showingOf = useLeavingStale(section.items.map(watchedItemOf));
  const items = section.items.filter((item) => showingOf(watchedItemOf(item)) !== 'gone');
  const leaving = new Set(items.filter((item) => showingOf(watchedItemOf(item)) === 'leaving').map(({ deliveryId }) => deliveryId));
  return <ArgoSectionList section={{ ...section, items }} now={now} leaving={leaving} />;
}
