'use client';

import { useState, useTransition } from 'react';

import { markMessagesDone } from '../hooks/bridge-actions';
import type { BridgeHome } from '../services/items';
import { markedDoneSaidOf, markSeenDoneOf, messagesPageSaidOf } from '../services/messages';
import { ActionButton } from '../ui/action-button';
import { Notice } from '../ui/notice';
import { ItemFocus } from './item-focus';
import { MessageRows } from './message-rows';

type Message = BridgeHome['messages'][number];

/**
 * Marking the seen messages done in one go (#242, messages page): it asks
 * first, saying the new ones stay; then Marking done... until the fleet
 * answered each, and says what it did, naming any it could not mark, which
 * stay. Never the new ones.
 */
function MarkSeenDone({ fleetId, messages }: { fleetId: string; messages: readonly Message[] }) {
  const [isAsking, setIsAsking] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [outcome, setOutcome] = useState<{ message: string; isFailure: boolean } | undefined>();
  const [, startTransition] = useTransition();
  const seen = messages.filter(({ state }) => state === 'seen');
  const said = markSeenDoneOf({ seenCount: seen.length, newCount: messages.length - seen.length });

  const markDone = () => {
    setIsPending(true);
    setOutcome(undefined);
    startTransition(async () => {
      const marked = await markMessagesDone({ fleet: fleetId, messages: seen.map(({ deliveryId, title }) => ({ deliveryId, title })) });
      setIsPending(false);
      setIsAsking(false);
      setOutcome(marked.isOk ? { message: markedDoneSaidOf(marked.value), isFailure: marked.value.failed.length > 0 } : { message: `Nothing was marked done: ${marked.message}`, isFailure: true });
    });
  };

  return (
    <div className="grid gap-2">
      {seen.length === 0 || isAsking ? null : (
        <ActionButton data-testid="bridge-mark-seen-done" className="justify-self-start" isPending={false} pendingLabel={said.pending} onClick={() => { setIsAsking(true); setOutcome(undefined); }}>
          {said.button}
        </ActionButton>
      )}
      {isAsking ? (
        <div role="alertdialog" aria-labelledby="bridge-mark-seen-question" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
          <span id="bridge-mark-seen-question">{said.question}</span>
          <span className="flex gap-2 sm:ml-auto">
            <ActionButton data-testid="bridge-mark-seen-confirm" variant="primary" isPending={isPending} pendingLabel={said.pending} onClick={markDone}>
              {said.confirm}
            </ActionButton>
            <ActionButton data-testid="bridge-mark-seen-cancel" isPending={false} pendingLabel="" disabled={isPending} onClick={() => { setIsAsking(false); }}>
              Cancel
            </ActionButton>
          </span>
        </div>
      ) : null}
      {outcome === undefined ? null : <Notice message={outcome.message} isFailure={outcome.isFailure} />}
    </div>
  );
}

/**
 * The Messages page (#242, design/bridge-messages): every plain message to
 * the person, newest on top, a dot on the new ones, outside the count, Done
 * and Open on each; the seen ones marked done in one go. Opening one shows
 * it beside the list, its whole text, Your answer, Answer and Done.
 */
export function MessagesPanel({ fleetId, messages, now }: { fleetId: string; messages: readonly Message[]; now: string }) {
  const newCount = messages.filter(({ state }) => state === 'new').length;
  return (
    <ItemFocus fleetId={fleetId} known={messages}>
      {(opening) => (
        <section className="grid gap-3" aria-labelledby="bridge-messages-heading">
          <div className={`grid gap-1 ${opening.opened === undefined ? '' : 'px-3 pt-2.5'}`}>
            <h1 id="bridge-messages-heading" className={`max-sm:sr-only ${opening.opened === undefined ? 'text-heading font-semibold' : 'font-semibold'}`}>
              Messages <span data-testid="bridge-messages-count" className="text-muted-foreground">{messages.length}</span>
            </h1>
            {messages.length === 0 ? null : <p className="text-caption text-muted-foreground">{messagesPageSaidOf({ newCount, seenCount: messages.length - newCount })}</p>}
          </div>
          {opening.opened === undefined ? <MarkSeenDone fleetId={fleetId} messages={messages} /> : null}
          {messages.length === 0 ? (
            <p data-testid="bridge-no-messages" className="rounded-md border border-border bg-card p-3 text-muted-foreground">
              No message waits. What you marked done is in Done.
            </p>
          ) : (
            <MessageRows fleetId={fleetId} messages={messages} readAt={new Date(now)} opening={opening} />
          )}
        </section>
      )}
    </ItemFocus>
  );
}
