'use client';

import { OverviewFailed } from '../../../features/overview/ui/overview-failed';

export default function OverviewError({ error, reset }: { error: Error; reset: () => void }) {
  return <OverviewFailed message={error.message} onTryAgain={reset} />;
}
