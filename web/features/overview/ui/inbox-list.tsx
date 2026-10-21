import type { InboxEntry } from '../services/deliveries';
import { ActionButton } from './action-button';
import { Notice } from './notice';

function EntryText({ entry }: { entry: InboxEntry }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col text-left">
      <span className="truncate">{entry.title}</span>
      <span className="text-caption text-muted-foreground">from {entry.from}</span>
    </span>
  );
}

/**
 * The person's inbox in two groups (aeolus-fleet #1046): what waits, which
 * they open one at a time, and what they opened and have not answered or
 * been done with yet. A failure to open says why by the delivery.
 */
export function InboxList({
  waitingCount,
  waiting,
  opened,
  openingId,
  failure,
  onOpen,
  onFocus,
}: {
  waitingCount: number;
  waiting: readonly InboxEntry[];
  opened: readonly InboxEntry[];
  openingId: string | undefined;
  failure: { deliveryId: string; message: string } | undefined;
  onOpen: (entry: InboxEntry) => void;
  onFocus: (entry: InboxEntry) => void;
}) {
  return (
    <div className="grid gap-6">
      {waiting.length === 0 ? null : (
        <section className="grid gap-2">
          <h2 className="text-section font-semibold">Next · {waitingCount}</h2>
          {waiting.map((entry) => (
            <div key={entry.deliveryId} className="grid gap-2 rounded-md border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                <EntryText entry={entry} />
                <ActionButton data-testid="overview-open" isPending={openingId === entry.deliveryId} pendingLabel="Opening..." disabled={openingId !== undefined} onClick={() => { onOpen(entry); }}>
                  Open
                </ActionButton>
              </div>
              {failure?.deliveryId === entry.deliveryId ? <Notice message={failure.message} isFailure /> : null}
            </div>
          ))}
        </section>
      )}
      {opened.length === 0 ? null : (
        <section className="grid gap-2">
          <h2 className="text-section font-semibold">Opened, not yet dealt with · {opened.length}</h2>
          {opened.map((entry) => (
            <div key={entry.deliveryId} className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
              <EntryText entry={entry} />
              <button type="button" data-testid="overview-deal" onClick={() => { onFocus(entry); }} className="inline-flex h-9 items-center rounded-md border border-border px-4 hover:bg-accent">
                Answer or be done
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
