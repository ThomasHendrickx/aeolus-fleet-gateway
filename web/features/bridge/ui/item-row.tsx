import type { ReactNode } from 'react';

import type { Stale } from '../services/deliveries';
import { jobLabelOf, type HomeItem } from '../services/items';
import { Notice } from './notice';
import { StaleIcon } from './stale-icon';

/** When an item was sent, in UTC, to the minute. */
function sentAtOf(sentAt: string): string {
  return `${new Date(sentAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * One item in a Bridge list: a dot while new, its title, its job and who
 * sent it, when, what came of it once said, and its action; struck through,
 * on muted ground and marked, when stale (basket.html). The row and its
 * title shrink to a phone's width (aeolus-fleet#1238).
 */
export function ItemRow({
  item,
  isNew,
  staleKind,
  outcome,
  failure,
  children,
}: {
  item: Pick<HomeItem, 'deliveryId' | 'from' | 'title' | 'sentAt' | 'job'>;
  isNew: boolean;
  /** How its asker made it stale, withdrawn or replaced, outside the count; none while it stands. */
  staleKind?: Stale['kind'];
  outcome: string | undefined;
  failure: string | undefined;
  children: ReactNode;
}) {
  return (
    <li data-testid="bridge-item" data-stale={staleKind !== undefined} className={`grid min-w-0 gap-2 rounded-md border border-border p-3 ${staleKind === undefined ? 'bg-card' : 'bg-muted'}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="flex min-w-0 items-center gap-2">
            {isNew ? <span aria-label="New" className="size-2 shrink-0 rounded-full bg-primary" /> : null}
            <span className="truncate font-medium">{staleKind === undefined ? item.title : <s className="decoration-muted-foreground">{item.title}</s>}</span>
          </span>
          <span className="text-caption text-muted-foreground">
            {jobLabelOf(item.job)} · {item.from} · <time dateTime={item.sentAt}>{sentAtOf(item.sentAt)}</time>
          </span>
          {outcome === undefined ? null : (
            <span data-testid="bridge-outcome" className="flex items-center gap-1.5 text-caption">
              {staleKind === undefined ? null : <StaleIcon kind={staleKind} />}
              {outcome}
            </span>
          )}
        </span>
        {children}
      </div>
      {failure === undefined ? null : <Notice message={failure} isFailure />}
    </li>
  );
}
