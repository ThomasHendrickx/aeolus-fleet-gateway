import { Ban, Replace } from 'lucide-react';

import type { Stale } from '../services/deliveries';

/** The mark of a stale question or step, as the mockups draw it: ban when withdrawn, swap when replaced. */
export function StaleIcon({ kind }: { kind: Stale['kind'] }) {
  const Icon = kind === 'withdrawn' ? Ban : Replace;
  return <Icon role="img" aria-label={kind === 'withdrawn' ? 'Withdrawn' : 'Replaced'} className="size-3.5 shrink-0 text-muted-foreground" />;
}
