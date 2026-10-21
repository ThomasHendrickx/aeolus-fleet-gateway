'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** The page's live updates, which the web app's server follows on the gateway's API for the browser. */
export const CHANGES_PATH = '/overview/changes';

/**
 * Keeps the page in step with its fleet's requests: whenever one changes,
 * the page reads itself again on the server, as its own caller. The browser
 * opens the stream again by itself when it drops.
 */
export function useLiveRefresh(fleetId: string): void {
  const router = useRouter();
  useEffect(() => {
    const changes = new EventSource(`${CHANGES_PATH}?fleet=${encodeURIComponent(fleetId)}`);
    changes.onmessage = () => {
      router.refresh();
    };
    return () => {
      changes.close();
    };
  }, [fleetId, router]);
}
