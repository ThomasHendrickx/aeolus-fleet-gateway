'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** The page's live updates, which the web app's server follows on the gateway's API for the browser. */
export const CHANGES_PATH = '/bridge/changes';

/**
 * Keeps the page in step with its fleet's requests: whenever one changes,
 * the page reads itself again on the server, as its own caller. The browser
 * opens the stream again by itself when it drops. Answers whether the stream
 * is open now, so the page can say it is live.
 */
export function useLiveRefresh(fleetId: string): boolean {
  const router = useRouter();
  const [isLive, setIsLive] = useState(false);
  useEffect(() => {
    const changes = new EventSource(`${CHANGES_PATH}?fleet=${encodeURIComponent(fleetId)}`);
    changes.onopen = () => {
      setIsLive(true);
    };
    changes.onerror = () => {
      setIsLive(false);
    };
    changes.onmessage = () => {
      router.refresh();
    };
    return () => {
      changes.close();
    };
  }, [fleetId, router]);
  return isLive;
}
