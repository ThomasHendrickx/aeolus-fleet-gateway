'use client';

import type { BridgeHome, HomeItem } from '../services/items';
import { lastReadTimeOf } from '../services/last-read';
import { useLastReadAt } from './kept-read';
import { SendMessageButton } from './send-message-button';

function countsOf(items: readonly HomeItem[]): string {
  const counted = items.filter(({ stale }) => stale === null);
  const toDecide = counted.filter(({ job }) => job === 'decide').length;
  const toDo = counted.filter(({ job }) => job === 'do').length;
  return `${String(toDecide)} to decide, ${String(toDo)} to do. Newest on top; nothing else is in this count.`;
}

/**
 * Bridge home's title row, across what waits and Your fleet (home.html,
 * design/bridge-fleet-width): what waits on the person with its one count
 * and what is in it, and at its right end sending any ship a message. On
 * the phone the title and its count alone; the phone sends from its top bar.
 * While the record cannot be read (states.html), when it was last read in
 * place of the count, left out on the phone, as its frame draws it.
 */
export function HomeHeading({ waiting }: { waiting: BridgeHome['waiting'] }) {
  const lastReadAt = useLastReadAt();
  if (lastReadAt !== undefined) {
    return (
      <div className="max-sm:hidden">
        <h1 id="bridge-waiting-heading" className="text-heading font-semibold">
          Waiting on you
        </h1>
        <p className="text-muted-foreground" data-testid="bridge-last-read">{`Last read ${lastReadTimeOf(lastReadAt)}`}</p>
      </div>
    );
  }
  return (
    <div data-testid="bridge-title-row" className="flex items-start justify-between gap-3">
      <div>
        <h1 id="bridge-waiting-heading" className="text-heading font-semibold">
          Waiting on you <span data-testid="bridge-count" className="text-tone-waiting-fg">{waiting.count}</span>
        </h1>
        <p className="text-muted-foreground max-sm:hidden">{waiting.count === 0 ? 'Nothing waits on you.' : countsOf(waiting.items)}</p>
      </div>
      <span className="max-sm:hidden">
        <SendMessageButton look="words" />
      </span>
    </div>
  );
}
