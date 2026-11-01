import type { ReactNode } from 'react';

import { jobLabelOf, type HomeItem } from '../services/items';
import { Notice } from './notice';

/** When an item was sent, in UTC, to the minute. */
function sentAtOf(sentAt: string): string {
  return `${new Date(sentAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * One item in a Bridge list: a dot while new, its title, its job and who
 * sent it, when, what came of it once said, and its action; faded when stale. The row and its
 * title shrink to a phone's width (aeolus-fleet#1238).
 */
export function ItemRow({
  item,
  isNew,
  isStale = false,
  outcome,
  failure,
  children,
}: {
  item: Pick<HomeItem, 'deliveryId' | 'from' | 'title' | 'sentAt' | 'job'>;
  isNew: boolean;
  /** Whether it is a question its asker withdrew or replaced: shown faded, outside the count. */
  isStale?: boolean;
  outcome: string | undefined;
  failure: string | undefined;
  children: ReactNode;
}) {
  return (
    <li data-testid="bridge-item" data-stale={isStale} className={`grid min-w-0 gap-2 rounded-md border border-border bg-card p-3 ${isStale ? 'opacity-60' : ''}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="flex min-w-0 items-center gap-2">
            {isNew ? <span aria-label="New" className="size-2 shrink-0 rounded-full bg-primary" /> : null}
            <span className="truncate font-medium">{item.title}</span>
          </span>
          <span className="text-caption text-muted-foreground">
            {jobLabelOf(item.job)} · {item.from} · <time dateTime={item.sentAt}>{sentAtOf(item.sentAt)}</time>
          </span>
          {outcome === undefined ? null : <span data-testid="bridge-outcome" className="text-caption">{outcome}</span>}
        </span>
        {children}
      </div>
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </li>
  );
}
