'use client';

import { useLiveRefresh } from '../hooks/use-live-refresh';

/** Keeps the page it sits in live: it shows nothing itself. */
export function LiveRefresh({ fleetId }: { fleetId: string }) {
  useLiveRefresh(fleetId);
  return null;
}
