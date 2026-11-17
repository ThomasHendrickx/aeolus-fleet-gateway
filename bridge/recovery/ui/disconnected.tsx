import { InlineError } from '@aeolus-fleet/ui';

/** M14: recovery remains a fleet manager's manual action in Console Settings. */
export function Disconnected({ isRetrying, onRetry }: { isRetrying: boolean; onRetry: () => void }) {
  return <InlineError title="The gateway is not connected to your fleet" description="A fleet manager can connect the gateway in Console Settings. Ask your builder if you cannot manage this fleet." onRetry={onRetry} isRetrying={isRetrying} />;
}
