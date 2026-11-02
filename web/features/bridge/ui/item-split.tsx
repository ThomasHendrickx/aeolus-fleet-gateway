import type { ReactNode } from 'react';

/**
 * A Bridge list and its open item (decide.html, aeolus-fleet#1538): on a
 * desktop the list beside the item; on a phone the item on its
 * own screen, back to the list by its chevron. On a desktop the two panes
 * fill the area under the top bar edge to edge, a divider between them. While none is open, the list
 * alone.
 */
export function ItemSplit({ list, item }: { list: ReactNode; item: ReactNode }) {
  if (item === undefined) {
    return <div className="grid gap-4">{list}</div>;
  }
  return (
    <div data-testid="bridge-split" className="grid min-w-0 md:-mx-6 md:-my-5 md:min-h-[calc(100dvh-3.5rem)] md:grid-cols-[340px_minmax(0,1fr)]">
      <div data-testid="bridge-split-list" className="hidden min-w-0 border-r border-border md:block">
        {list}
      </div>
      {item}
    </div>
  );
}
