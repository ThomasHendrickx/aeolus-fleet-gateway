'use client';

import { useFocusReport } from '../hooks/use-focus-report';
import { useLiveRefresh } from '../hooks/use-live-refresh';

/** Keeps the page it sits in live, and tells the gateway while it is in focus (wake a person, W6): it shows nothing itself. */
export function LiveRefresh({ fleetId }: { fleetId: string }) {
  useLiveRefresh(fleetId);
  useFocusReport(fleetId);
  return null;
}
