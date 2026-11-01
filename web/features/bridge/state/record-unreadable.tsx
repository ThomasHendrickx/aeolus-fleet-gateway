'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** How long Bridge waits before it reads the record again by itself. */
const TRY_AGAIN_MS = 10_000;

/**
 * The record cannot be read now (Bridge, section 9: core does not answer):
 * why, that nothing is lost, since nothing was acknowledged, and the page
 * reads itself again every 10 seconds, or at once on Try now.
 */
export function RecordUnreadable({ message }: { message: string }) {
  const router = useRouter();
  useEffect(() => {
    const again = setInterval(() => {
      router.refresh();
    }, TRY_AGAIN_MS);
    return () => {
      clearInterval(again);
    };
  }, [router]);
  return (
    <section role="alert" data-testid="bridge-unreadable" className="flex flex-wrap items-center gap-3 rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">The record cannot be read now</span>
        <span className="text-caption">
          {message} Nothing was opened or answered, so nothing is lost: Bridge tries again in 10 s.
        </span>
      </span>
      <button type="button" data-testid="bridge-try-now" onClick={() => { router.refresh(); }} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-card-foreground hover:bg-accent">
        Try now
      </button>
    </section>
  );
}
