'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import { nextShownOf, type KeptPart } from '../services/last-read';

const LastReadContext = createContext<string | undefined>(undefined);

/**
 * A part of a Bridge page the server read, kept in the browser while the
 * page is open (states.html): read now, it shows and is kept; while the
 * record cannot be read, the part last read shows in its place, and what is
 * inside it can tell with useLastReadAt. With nothing read yet, the
 * server's own answer shows, such as nothing at all.
 */
export function KeptRead({ readAt, children }: { readAt: string | undefined; children: ReactNode }) {
  const [kept, setKept] = useState<KeptPart<ReactNode> | undefined>();
  const next = nextShownOf(kept, { readAt, part: children });
  // Each read the server answers carries its own time: a new time is a new read to keep.
  if (next.kept?.readAt !== kept?.readAt) {
    setKept(next.kept);
  }
  return <LastReadContext value={next.shown.lastReadAt}>{next.shown.part}</LastReadContext>;
}

/** When what shows was last read, while it shows as last read; undefined while it is read now. */
export function useLastReadAt(): string | undefined {
  return useContext(LastReadContext);
}
