'use client';

import { Check, CheckCheck } from 'lucide-react';
import { useState, useTransition } from 'react';

import { markMessagesDone } from '../hooks/bridge-actions';
import type { BridgeHome } from '../services/items';
import { markedDoneSaidOf, markSeenDoneOf, messagesPageSaidOf } from '../services/messages';
import { ActionButton } from '../ui/action-button';
import { Notice } from '../ui/notice';
import { ItemFocus } from './item-focus';
import { MessageRows } from './message-rows';
import { usePhoneCount } from './opened-item';

type Message = BridgeHome['messages'][number];

/** What marking the seen ones done comes to: asking first, then what it did. */
type Marking = { readonly kind: 'idle' } | { readonly kind: 'asking' } | { readonly kind: 'marked'; readonly said: string; readonly isFailure: boolean };

/** Marking the seen messages done in one go, from the page's heading row: its button, while none is asked. */
function MarkSeenDoneButton({ said, onAsk }: { said: string; onAsk: () => void }) {
  return (
    <ActionButton data-testid="bridge-mark-seen-done" size="row" className="shrink-0 gap-1.5" isPending={false} pendingLabel="" onClick={onAsk}>
      <CheckCheck aria-hidden="true" className="size-3.5" />
      {said}
    </ActionButton>
  );
}

/**
 * Asking before the seen messages are marked done (#242, messages page):
 * on amber ground, saying the new ones stay; Mark N done says Marking
 * done... until the fleet answered each, Cancel leaves them.
 */
function MarkSeenDoneQuestion({ question, confirm, pending, isPending, onConfirm, onCancel }: { question: string; confirm: string; pending: string; isPending: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="alertdialog" aria-labelledby="bridge-mark-seen-question" className="flex flex-wrap items-center gap-2 rounded-lg border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2.5 text-meta">
      <span id="bridge-mark-seen-question" className="mr-auto">
        {question}
      </span>
      <ActionButton data-testid="bridge-mark-seen-confirm" variant="primary" size="row" className="gap-1.5" isPending={isPending} pendingLabel={pending} onClick={onConfirm}>
        <Check aria-hidden="true" className="size-3.5" />
        {confirm}
      </ActionButton>
      <ActionButton data-testid="bridge-mark-seen-cancel" size="row" isPending={false} pendingLabel="" disabled={isPending} onClick={onCancel}>
        Cancel
      </ActionButton>
    </div>
  );
}

/**
 * The Messages page (#242, design/bridge-messages): every plain message to
 * the person, newest on top, a dot on the new ones, outside the count, Done
 * and Open on each, in a reading column; the seen ones marked done in one go
 * from the heading row, asking first and never the new ones. Opening one
 * shows it beside the list, its whole text, Your answer, Answer and Done. On a
 * phone the top bar names the page with its count.
 */
export function MessagesPanel({ fleetId, messages, now }: { fleetId: string; messages: readonly Message[]; now: string }) {
  const [marking, setMarking] = useState<Marking>({ kind: 'idle' });
  const [isPending, setIsPending] = useState(false);
  const [, startTransition] = useTransition();
  usePhoneCount(messages.length);
  const seen = messages.filter(({ state }) => state === 'seen');
  const newCount = messages.length - seen.length;
  const said = markSeenDoneOf({ seenCount: seen.length, newCount });

  const markDone = () => {
    setIsPending(true);
    startTransition(async () => {
      const marked = await markMessagesDone({ fleet: fleetId, messages: seen.map(({ deliveryId, title }) => ({ deliveryId, title })) });
      setIsPending(false);
      setMarking(marked.isOk ? { kind: 'marked', said: markedDoneSaidOf(marked.value), isFailure: marked.value.failed.length > 0 } : { kind: 'marked', said: `Nothing was marked done: ${marked.message}`, isFailure: true });
    });
  };

  return (
    <ItemFocus fleetId={fleetId} known={messages}>
      {(opening) => (
        <section className={`grid gap-3 ${opening.opened === undefined ? 'max-w-[44rem]' : ''}`} aria-labelledby="bridge-messages-heading">
          <div data-testid="bridge-messages-head" className={`flex items-start justify-between gap-3 ${opening.opened === undefined ? '' : 'px-3 pt-2.5'}`}>
            <div className="grid gap-1 max-sm:sr-only">
              <h1 id="bridge-messages-heading" className={opening.opened === undefined ? 'text-heading font-semibold' : 'font-semibold'}>
                Messages <span data-testid="bridge-messages-count" className="text-muted-foreground">{messages.length}</span>
              </h1>
              {messages.length === 0 || opening.opened !== undefined ? null : <p className="text-caption text-muted-foreground max-sm:hidden">{messagesPageSaidOf({ newCount, seenCount: seen.length })}</p>}
            </div>
            {opening.opened === undefined && seen.length > 0 && marking.kind !== 'asking' ? <MarkSeenDoneButton said={said.button} onAsk={() => { setMarking({ kind: 'asking' }); }} /> : null}
          </div>
          {opening.opened === undefined && marking.kind === 'asking' ? <MarkSeenDoneQuestion question={said.question} confirm={said.confirm} pending={said.pending} isPending={isPending} onConfirm={markDone} onCancel={() => { setMarking({ kind: 'idle' }); }} /> : null}
          {marking.kind !== 'marked' ? null : marking.isFailure ? (
            <Notice message={marking.said} isFailure />
          ) : (
            <p role="status" data-testid="bridge-success" className="flex items-center gap-2 rounded-lg border border-tone-ok-border bg-tone-ok-bg px-3 py-2.5 text-meta text-tone-ok-fg">
              <Check aria-hidden="true" className="size-3.5 shrink-0" />
              {marking.said}
            </p>
          )}
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
