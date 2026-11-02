'use client';

import { lastReadTimeOf } from '../services/last-read';
import { useLastReadAt } from './kept-read';

/**
 * Bridge home's title row as last read, while the record cannot be read
 * (states.html): what waits, and when it was read in place of the count,
 * above the banners; left out on the phone, as its frame draws it. Read now,
 * home's lists carry their own title row.
 */
export function LastReadHeading() {
  const lastReadAt = useLastReadAt();
  if (lastReadAt === undefined) {
    return null;
  }
  return (
    <div className="max-sm:hidden">
      <h1 id="bridge-waiting-heading" className="text-heading font-semibold">
        Waiting on you
      </h1>
      <p className="text-muted-foreground" data-testid="bridge-last-read">{`Last read ${lastReadTimeOf(lastReadAt)}`}</p>
    </div>
  );
}
