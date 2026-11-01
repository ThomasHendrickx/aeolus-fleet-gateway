import type { ReactNode } from 'react';

import { readTimeOf, type BridgeRead } from '../hooks/read-bridge';
import { FadedAsLastRead } from './faded-as-last-read';
import { KeptRead } from './kept-read';
import { RecordUnreadable } from './record-unreadable';

/**
 * A Bridge page's list from the record (states.html): as read now; while
 * the record cannot be read, the banner, over the list as last read, faded,
 * when this page read it before. The slots stay in place either way, so the
 * browser keeps what it last read.
 */
export function PageAsLastRead({ read, children }: { read: BridgeRead<unknown>; children: ReactNode }) {
  return (
    <div className="grid gap-4">
      {read.kind === 'unreadable' ? <RecordUnreadable whoDidNotAnswer={read.whoDidNotAnswer} /> : null}
      <KeptRead readAt={readTimeOf(read)}>
        <FadedAsLastRead>{children}</FadedAsLastRead>
      </KeptRead>
    </div>
  );
}
