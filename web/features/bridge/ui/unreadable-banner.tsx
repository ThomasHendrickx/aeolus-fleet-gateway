import { CloudOff } from 'lucide-react';
import type { ReactNode } from 'react';

/** Who did not answer when the record could not be read: the fleet (core), or the gateway itself. */
export type WhoDidNotAnswer = 'fleet' | 'gateway';

/**
 * The record cannot be read now (states.html; Bridge, section 9: core does
 * not answer): who did not answer, that nothing is lost, since nothing was
 * acknowledged, and when Bridge tries again, with Try now beside it on a
 * wide screen; the phone's words are shorter.
 */
export function UnreadableBanner({ whoDidNotAnswer, tryNow }: { whoDidNotAnswer: WhoDidNotAnswer; tryNow: ReactNode }) {
  return (
    <section role="alert" data-testid="bridge-unreadable" className="flex items-start gap-2.5 rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2.5">
      <CloudOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tone-attention-fg" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">The record cannot be read now</span>
        <span data-testid="bridge-unreadable-why" className="text-meta text-muted-foreground max-sm:hidden">
          The {whoDidNotAnswer} did not answer. Nothing was opened or answered, so nothing is lost; Bridge tries again in 10 s.
        </span>
        <span data-testid="bridge-unreadable-why-phone" className="text-meta text-muted-foreground sm:hidden">
          Nothing is lost. Trying again in 10 s.
        </span>
      </span>
      <span className="shrink-0 max-sm:hidden">{tryNow}</span>
    </section>
  );
}
