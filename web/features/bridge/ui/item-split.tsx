import type { ReactNode } from 'react';

/**
 * A Bridge list and its open item (decide.html, aeolus-fleet#1538): on a
 * desktop the list beside the item, in one frame; on a phone the item on its
 * own screen, back to the list by its chevron. While none is open, the list
 * alone.
 */
export function ItemSplit({ list, item }: { list: ReactNode; item: ReactNode }) {
  if (item === undefined) {
    return <div className="grid gap-4">{list}</div>;
  }
  return (
    <div data-testid="bridge-split" className="grid min-w-0 md:grid-cols-[340px_minmax(0,1fr)] md:overflow-hidden md:rounded-lg md:border md:border-border md:bg-card">
      <div data-testid="bridge-split-list" className="hidden min-w-0 border-r border-border md:block">
        {list}
      </div>
      {item}
    </div>
  );
}
