import { EmptyState } from '@aeolus-fleet/ui';

import type { MeetingView } from '../services/meeting';

/** A meeting's contributions, newest first: who said it, when, and what. */
export function Contributions({ items }: { items: MeetingView['contributions']['items'] }) {
  if (items.length === 0) {
    return <EmptyState title="No one has contributed yet." variant="section" />;
  }
  return (
    <ol data-testid="meeting-contributions" className="grid gap-3">
      {items.map((contribution) => (
        <li key={contribution.messageId} className="grid gap-1 rounded-md border border-border bg-card p-3 text-card-foreground">
          <span className="text-caption text-muted-foreground">
            {contribution.sender.name} · {new Date(contribution.sentAt).toUTCString()}
          </span>
          <p className="whitespace-pre-wrap break-words">{contribution.payload}</p>
        </li>
      ))}
    </ol>
  );
}
