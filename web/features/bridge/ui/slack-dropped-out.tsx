import { Hash } from 'lucide-react';

import { inFleet } from '../../../lib/gateway-api/page-account';
import { BRIDGE_ROUTING_PATH } from '../paths';

/**
 * Slack dropped out (states.html; Bridge, section 9: a place fails, it
 * drops out and Bridge says why): the fleet's own bot was removed in Slack,
 * so Slack shows the person nothing, while Bridge and a chat still show
 * everything; it leads to where things show. The phone leaves it out, as
 * its frame draws it.
 */
export function SlackDroppedOut({ fleetId, botName }: { fleetId: string; botName: string }) {
  return (
    <section role="status" data-testid="bridge-slack-dropped-out" className="flex items-start max-sm:hidden gap-2.5 rounded-md border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2.5">
      <Hash aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tone-waiting-fg" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">Slack dropped out</span>
        <span className="text-meta text-muted-foreground">{`The ${botName} bot was removed from your workspace, so Slack shows nothing. Everything still shows here and in a chat.`}</span>
      </span>
      <a href={inFleet(BRIDGE_ROUTING_PATH, fleetId)} className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-card-foreground hover:bg-accent">
        Where things show
      </a>
    </section>
  );
}
