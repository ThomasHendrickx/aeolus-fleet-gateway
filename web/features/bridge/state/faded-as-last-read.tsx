'use client';

import type { ReactNode } from 'react';

import { lastReadTimeOf } from '../services/last-read';
import { useLastReadAt } from './kept-read';

/**
 * A page's list as last read while the record cannot be read (states.html):
 * faded and inert, every button but the rows' titles left out, since acting
 * goes through the fleet, with when it was read under it; untouched while it
 * is read now.
 */
export function FadedAsLastRead({ children }: { children: ReactNode }) {
  const lastReadAt = useLastReadAt();
  if (lastReadAt === undefined) {
    return children;
  }
  return (
    <div className="grid gap-3">
      <div inert className="opacity-60 [&_button:not([data-testid=bridge-item-title])]:hidden">
        {children}
      </div>
      <p className="text-caption text-muted-foreground">{`Shown as last read, at ${lastReadTimeOf(lastReadAt)}.`}</p>
    </div>
  );
}
