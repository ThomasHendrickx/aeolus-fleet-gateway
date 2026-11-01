import { CircleCheck, CirclePause, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { PlaceCard as PlaceCardState } from '../services/routing';

/**
 * A place on top of Where things show (the routing mockup): its icon and
 * name, its state on the right, what it does, and its one action below.
 */
export function PlaceCard({ place, name, Icon, card, children }: { place: string; name: string; Icon: LucideIcon; card: PlaceCardState; children?: ReactNode }) {
  const StateIcon = card.state.isOk ? CircleCheck : CirclePause;
  return (
    <div data-testid={`bridge-place-${place}`} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <span className="flex items-center gap-2 font-medium">
        <Icon aria-hidden className="size-4 shrink-0" />
        {name}
        <span data-testid={`bridge-place-${place}-state`} className={`ml-auto inline-flex items-center gap-1 text-caption font-medium ${card.state.isOk ? 'text-tone-ok-fg' : 'text-muted-foreground'}`}>
          <StateIcon aria-hidden className="size-3.5" />
          {card.state.label}
        </span>
      </span>
      <span className="text-caption text-muted-foreground">{card.description}</span>
      {children === undefined ? null : <span className="mt-auto flex flex-col items-start gap-1.5">{children}</span>}
    </div>
  );
}
