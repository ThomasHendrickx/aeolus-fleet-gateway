import { CARD } from '../../forms/ui/look';
import { failedReasonText } from '../services/authorize';

/** A browser that got nowhere connecting an MCP client: why, as the gateway named it. */
export function AuthorizeFailed({ reason }: { reason: string | undefined }) {
  return (
    <section className={CARD} data-testid="authorize-failed">
      <h1 className="text-heading font-semibold">Connect an MCP client</h1>
      <p role="alert" data-testid="authorize-failed-reason" className="mt-2 text-muted-foreground">
        {failedReasonText(reason)}
      </p>
    </section>
  );
}
