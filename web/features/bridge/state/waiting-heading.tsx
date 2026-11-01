'use client';

import type { BridgeHome, HomeItem } from '../services/items';
import { lastReadTimeOf } from '../services/last-read';
import { useLastReadAt } from './kept-read';

function countsOf(items: readonly HomeItem[]): string {
  const counted = items.filter(({ stale }) => stale === null);
  const toDecide = counted.filter(({ job }) => job === 'decide').length;
  const toDo = counted.filter(({ job }) => job === 'do').length;
  return `${String(toDecide)} to decide, ${String(toDo)} to do. Newest on top; nothing else is in this count.`;
}

/**
 * Bridge home's title row (home.html, states.html): what waits on the
 * person with its one count, and how many to decide and to do; as last
 * read, while the record cannot be read, when it was read in place of the
 * count, and on the phone nothing, as its frame draws it (states.html).
 */
export function WaitingHeading({ waiting }: { waiting: BridgeHome['waiting'] }) {
  const lastReadAt = useLastReadAt();
  return (
    <div className={lastReadAt === undefined ? undefined : 'max-sm:hidden'}>
      <h1 id="bridge-waiting-heading" className="text-heading font-semibold">
        Waiting on you
        {lastReadAt === undefined ? (
          <>
            {' '}
            <span data-testid="bridge-count" className="text-tone-waiting-fg">
              {waiting.count}
            </span>
          </>
        ) : null}
      </h1>
      {lastReadAt === undefined ? (
        <p className="text-muted-foreground">{waiting.count === 0 ? 'Nothing waits on you.' : countsOf(waiting.items)}</p>
      ) : (
        <p className="text-muted-foreground" data-testid="bridge-last-read">{`Last read ${lastReadTimeOf(lastReadAt)}`}</p>
      )}
    </div>
  );
}
