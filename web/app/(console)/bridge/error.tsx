'use client';

import { BridgeFailed } from '../../../features/bridge/ui/bridge-failed';

export default function BridgeError({ error, reset }: { error: Error; reset: () => void }) {
  return <BridgeFailed message={error.message} onTryAgain={reset} />;
}
