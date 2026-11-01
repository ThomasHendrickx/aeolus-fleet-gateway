import { CircleAlert, CirclePause, CirclePlay, Hourglass } from 'lucide-react';

import type { ShipState } from '../services/your-fleet';

const ICONS = { alert: CircleAlert, waiting: Hourglass, working: CirclePlay, idle: CirclePause } as const;

/** A ship state's mark, as Harbour draws it; always beside its word, so it never rests on the icon alone. */
export function StateIcon({ state }: { state: ShipState }) {
  const Icon = ICONS[state];
  return <Icon aria-hidden="true" className="size-3 shrink-0" />;
}
