import { MessageSquare } from 'lucide-react';

import { newMessagesSaidOf } from '../services/messages';

/** The line on top of a phone's Waiting tab (#242, design/bridge-messages): with more messages than home lists, how many new ones wait far below, leading to the Messages page. */
export function NewMessagesLine({ href, newCount }: { href: string; newCount: number }) {
  return (
    <a data-testid="bridge-new-messages" href={href} className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 sm:hidden">
      <MessageSquare aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span>{newMessagesSaidOf(newCount)}</span>
      <span className="ml-auto font-medium text-primary">Show</span>
    </a>
  );
}
