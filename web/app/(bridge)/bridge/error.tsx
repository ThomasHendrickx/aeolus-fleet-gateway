'use client';

import { InlineError } from '@aeolus-fleet/ui';

export default function BridgeError({ error, reset }: { error: Error; reset: () => void }) {
  return <InlineError title="Bridge could not be read" description={`${error.message || "The gateway did not answer."} Try again in a moment.`} onRetry={reset} variant="page" />;
}
