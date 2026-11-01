import { CircleAlert, Info, SquareArrowOutUpRight } from 'lucide-react';

import { clearsSaidOf, type AlertView } from '../services/stay-aware';

/**
 * What an opened alert shows of its ship (stay-aware.html): the ship's tile
 * in the alert's tone, as the alert left it, since nothing is sent when it
 * clears (decision 0071); Open <ship>'s Health in the console for its state
 * now, when the fleet's console is known; and the info line saying so.
 */
export function AlertShip({ alert, healthHref }: { alert: AlertView; healthHref: string | undefined }) {
  const { name } = alert.ship;
  return (
    <div className="grid gap-3">
      <div data-testid="bridge-alert-tile" className="grid h-13 w-25 content-between rounded-md border border-tone-attention-border bg-tone-attention-bg px-2 py-1.5 text-tone-attention-fg">
        <span className="truncate text-caption font-semibold text-card-foreground">{name}</span>
        <span className="flex items-center gap-1 text-[11px]">
          <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
          Alert
        </span>
      </div>
      {healthHref === undefined ? null : (
        <a
          data-testid="bridge-ship-health"
          href={healthHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-2 justify-self-start rounded-md border border-border bg-card px-3 text-caption font-medium hover:bg-accent"
        >
          <SquareArrowOutUpRight aria-hidden="true" className="size-3.5 shrink-0" />
          {`Open ${name}’s Health`}
        </a>
      )}
      <p data-testid="bridge-alert-clears" className="flex items-start gap-1.5 text-caption text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>{clearsSaidOf(alert)}</span>
      </p>
    </div>
  );
}
