import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

import { SIZES } from './action-button';

/**
 * A link on an item's row that looks as its buttons do: where a step is
 * done. One that leads outside the gateway opens in a tab of its own, and
 * only by the person's own press (Bridge, section 9).
 */
export function RowLink({ href, isOutside, children, ...link }: { href: string; isOutside: boolean; children: ReactNode; 'data-testid'?: string }) {
  return (
    <a
      {...link}
      href={href}
      {...(isOutside ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`inline-flex items-center rounded-md border border-border bg-card text-card-foreground hover:bg-accent ${SIZES.row}`}
    >
      <ExternalLink aria-hidden="true" className="size-3.5" />
      {children}
    </a>
  );
}
