import { Ship } from 'lucide-react';

import { SHIP_STATES, STATE_LABELS, type ShipState, type YourFleet } from '../services/your-fleet';
import { StateIcon } from './state-icon';

const PLAIN = 'border-border bg-card text-card-foreground';

/** Only Alert is filled in its tone; Waiting and Working say theirs in the number; Idle stays plain. */
const NUMBER_TONES: Record<ShipState, string> = {
  alert: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  waiting: 'border-border bg-card text-tone-waiting-fg',
  working: 'border-border bg-card text-tone-ok-fg',
  idle: PLAIN,
};

/** A count takes its tone only above 0: a zero is drawn plain, so it does not draw the eye. */
function toneOf(state: ShipState, count: number): string {
  return count > 0 ? NUMBER_TONES[state] : PLAIN;
}

function FleetNumber({ testId, tone, value, children }: { testId: string; tone: string; value: number; children: React.ReactNode }) {
  return (
    <div data-testid={testId} className={`grid min-w-0 gap-0.5 rounded-md border px-2 py-1.5 max-sm:justify-items-center max-sm:px-0.5 ${tone}`}>
      <span className="text-xl leading-6 font-semibold">{value}</span>
      <span className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground max-sm:justify-center max-sm:gap-0.5 max-sm:text-[10px]">{children}</span>
    </div>
  );
}

/**
 * The numbers on top of Your fleet: Alert, Waiting, Working and Idle, each
 * with its icon and word; on the Fleet tab the ships first, as Harbour
 * leads with them.
 */
export function FleetNumbers({ fleet, isShipCountShown }: { fleet: YourFleet; isShipCountShown: boolean }) {
  return (
    <div className={`grid gap-1.5 max-sm:gap-1 ${isShipCountShown ? 'grid-cols-5' : 'grid-cols-4'}`}>
      {isShipCountShown ? (
        <FleetNumber testId="fleet-number-ships" tone={PLAIN} value={fleet.shipCount}>
          <Ship aria-hidden="true" className="size-3 shrink-0" />
          <span>Ships</span>
        </FleetNumber>
      ) : null}
      {SHIP_STATES.map((state) => (
        <FleetNumber key={state} testId={`fleet-number-${state}`} tone={toneOf(state, fleet.counts[state])} value={fleet.counts[state]}>
          <StateIcon state={state} />
          <span>{STATE_LABELS[state]}</span>
        </FleetNumber>
      ))}
    </div>
  );
}
