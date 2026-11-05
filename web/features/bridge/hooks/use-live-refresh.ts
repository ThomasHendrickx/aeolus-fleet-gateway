'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** The page's live updates, which the web app's server follows on the gateway's API for the browser. */
export const CHANGES_PATH = '/bridge/changes';

/** What the page does as its stream goes: read itself again, and say whether it is live. */
export interface FollowingPage {
  readonly readAgain: () => void;
  readonly showLive: (isLive: boolean) => void;
}

/** What the page hears of its stream: it opened, it dropped, or it told a change. */
export interface ChangesFollower {
  readonly opened: () => void;
  readonly dropped: () => void;
  readonly changed: () => void;
}

/** Follows the page's stream: each change reads the page again, and the page is live while the stream is open. */
export function changesFollowerOf(page: FollowingPage): ChangesFollower {
  return {
    opened: () => {
      page.showLive(true);
    },
    dropped: () => {
      page.showLive(false);
    },
    changed: () => {
      page.readAgain();
    },
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
    const follower = changesFollowerOf({ readAgain: () => { router.refresh(); }, showLive: setIsLive });
    changes.onopen = follower.opened;
    changes.onerror = follower.dropped;
    changes.onmessage = follower.changed;
    return () => {
      changes.close();
    };
  }, [fleetId, router]);
  return isLive;
}
