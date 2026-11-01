'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { UnreadableBanner, type WhoDidNotAnswer } from '../ui/unreadable-banner';

/** How long Bridge waits before it reads the record again by itself. */
const TRY_AGAIN_MS = 10_000;

/**
 * The record cannot be read now (Bridge, section 9: core does not answer):
 * the banner, and the page reads itself again every 10 seconds, or at once
 * on Try now.
 */
export function RecordUnreadable({ whoDidNotAnswer }: { whoDidNotAnswer: WhoDidNotAnswer }) {
  const router = useRouter();
  useEffect(() => {
    const again = setInterval(() => {
      router.refresh();
    }, TRY_AGAIN_MS);
    return () => {
      clearInterval(again);
    };
  }, [router]);
  const tryNow = (
    <button type="button" data-testid="bridge-try-now" onClick={() => { router.refresh(); }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-card-foreground hover:bg-accent">
      <RefreshCw aria-hidden="true" className="size-3.5" />
      Try now
    </button>
  );
  return <UnreadableBanner whoDidNotAnswer={whoDidNotAnswer} tryNow={tryNow} />;
}
