'use client';

import { useState, useTransition } from 'react';

import { removeFromBasket, sendBasket } from '../hooks/bridge-actions';
import { sendLabelOf, sentTextOf, standingTextOf, type BasketItem, type BasketView } from '../services/basket';
import { ActionButton } from '../ui/action-button';
import { Notice } from '../ui/notice';
import { ItemFocus, type ItemOpening } from './item-focus';

/** When a question was asked, in UTC, to the minute. */
function askedAtOf(sentAt: string): string {
  return `${new Date(sentAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** What the person is doing in the basket: removing one entry, or sending it. */
type Working = { kind: 'remove'; questionId: string } | { kind: 'send' };

/** One entry: the question, its asker and when it asked, the option and the note, what it stands as, and what can be done with it. */
function BasketEntryRow({ entry, opening, working, onRemove }: { entry: BasketItem; opening: ItemOpening; working: Working | undefined; onRemove: (questionId: string) => void }) {
  const { standing } = entry;
  const said = standingTextOf(entry);
  const isWorking = working !== undefined || opening.openingId !== undefined;
  const replacementId = standing.kind === 'replaced' ? standing.replacementId : null;
  return (
    <li data-testid="bridge-basket-entry" data-standing={standing.kind} className={`grid min-w-0 gap-2 rounded-md border border-border bg-card p-3 ${standing.kind === 'withdrawn' || standing.kind === 'replaced' || standing.kind === 'dealtElsewhere' ? 'opacity-60' : ''}`}>
      <span className="font-medium">{entry.title}</span>
      <span className="text-caption text-muted-foreground">
        to {entry.from} · asked at <time dateTime={entry.sentAt}>{askedAtOf(entry.sentAt)}</time>
      </span>
      <span>{entry.option === null ? 'Note alone' : `Option ${String(entry.option)}`}</span>
      {entry.note === null ? null : <span className="text-caption">“{entry.note}”</span>}
      {said === undefined ? null : <span data-testid="bridge-basket-standing" className="text-caption">{said}</span>}
      {opening.failure?.deliveryId === entry.deliveryId ? <Notice message={opening.failure.message} isFailure /> : null}
      <div className="flex flex-wrap gap-2">
        {standing.kind === 'waiting' ? (
          <ActionButton data-testid="bridge-basket-change" isPending={opening.openingId === entry.deliveryId} pendingLabel="Opening..." disabled={isWorking} onClick={() => { opening.open({ deliveryId: entry.deliveryId, job: 'decide', inBasket: { option: entry.option, note: entry.note } }); }}>
            Change
          </ActionButton>
        ) : null}
        {replacementId === null ? null : (
          <ActionButton data-testid="bridge-replacement" isPending={opening.openingId === replacementId} pendingLabel="Opening..." disabled={isWorking} onClick={() => { opening.open({ deliveryId: replacementId, job: 'decide' }); }}>
            Answer the new question
          </ActionButton>
        )}
        {standing.kind === 'sending' ? null : (
          <ActionButton data-testid="bridge-basket-remove" isPending={working?.kind === 'remove' && working.questionId === entry.questionId} pendingLabel="Removing..." disabled={isWorking} onClick={() => { onRemove(entry.questionId); }}>
            {standing.kind === 'refused' ? 'Remove and mark done' : 'Remove'}
          </ActionButton>
        )}
      </div>
    </li>
  );
}

/**
 * The basket open (docs/design/bridge, section 9): the answers the person
 * picked in Bridge and has not sent, in the order added. Change opens the
 * question with that option picked; Remove takes the entry out, and the
 * question still waits; one the fleet refused is removed and its question
 * marked done. Send N answers stores each as sending and the gateway sends
 * them, each on its own; a withdrawn, replaced or answered-elsewhere entry is
 * skipped and taken out, and Send says so.
 */
export function BasketPanel({ fleetId, basket }: { fleetId: string; basket: BasketView }) {
  const [working, setWorking] = useState<Working | undefined>();
  const [said, setSaid] = useState<{ message: string; isFailure: boolean } | undefined>();
  const [, startTransition] = useTransition();
  const { entries, toSend } = basket;

  const remove = (questionId: string) => {
    setWorking({ kind: 'remove', questionId });
    setSaid(undefined);
    startTransition(async () => {
      const outcome = await removeFromBasket(fleetId, questionId);
      setWorking(undefined);
      setSaid(outcome.isOk ? undefined : { message: outcome.message, isFailure: true });
    });
  };

  const send = () => {
    setWorking({ kind: 'send' });
    setSaid(undefined);
    startTransition(async () => {
      const outcome = await sendBasket(fleetId);
      setWorking(undefined);
      setSaid(outcome.isOk ? { message: sentTextOf(outcome.value), isFailure: false } : { message: outcome.message, isFailure: true });
    });
  };

  return (
    <ItemFocus fleetId={fleetId}>
      {(opening) => (
        <section className="grid gap-3" aria-labelledby="bridge-basket-heading">
          <div>
            <h1 id="bridge-basket-heading" className="text-heading font-semibold">
              Basket <span data-testid="bridge-basket-count">{entries.length}</span>
            </h1>
            <p className="text-muted-foreground">Answers you picked in Bridge, not sent yet. Nothing goes until you press Send.</p>
          </div>
          {said === undefined ? null : <Notice message={said.message} isFailure={said.isFailure} />}
          {entries.length === 0 ? (
            <div data-testid="bridge-basket-empty" className="grid justify-items-center gap-1 rounded-lg border border-border bg-card p-6 text-center">
              <span className="font-semibold">The basket is empty</span>
              <span className="text-muted-foreground">Open a question in Waiting on you and put your answer in the basket.</span>
            </div>
          ) : (
            <ul className="grid gap-2">
              {entries.map((entry) => (
                <BasketEntryRow key={entry.questionId} entry={entry} opening={opening} working={working} onRemove={remove} />
              ))}
            </ul>
          )}
          {toSend === 0 ? null : (
            <div className="grid gap-1">
              <p className="text-caption text-muted-foreground">Each asker receives its own answer, as you, as if sent one by one.</p>
              <ActionButton data-testid="bridge-basket-send" variant="primary" className="justify-self-start" isPending={working?.kind === 'send'} pendingLabel="Sending..." disabled={working !== undefined || opening.openingId !== undefined} onClick={send}>
                {sendLabelOf(toSend)}
              </ActionButton>
            </div>
          )}
        </section>
      )}
    </ItemFocus>
  );
}
