'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** The page's live updates, which the web app's server follows on the gateway's API for the browser. */
export const CHANGES_PATH = '/bridge/changes';

/** The browser's stream of the page's changes, as an EventSource answers it. */
export interface ChangesStream {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: Event) => void) | null;
}

/** What the page does as its stream goes: read itself again, and say whether it is live. */
export interface FollowingPage {
  readonly readAgain: () => void;
  readonly showLive: (isLive: boolean) => void;
}

/** Follows the page's stream: each change reads the page again, and the page is live while the stream is open. */
export function followChangesStream(changes: ChangesStream, page: FollowingPage): void {
  changes.onopen = () => {
    page.showLive(true);
  };
  changes.onerror = () => {
    page.showLive(false);
  };
  changes.onmessage = () => {
    page.readAgain();
  };
}

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
    followChangesStream(changes, { readAgain: () => { router.refresh(); }, showLive: setIsLive });
    return () => {
      changes.close();
    };
  }, [fleetId, router]);
  return isLive;
}
