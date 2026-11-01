'use client';

import { ArrowRight, Ban, Check, CircleAlert, CircleCheck, CircleQuestionMark, Clock, LoaderCircle, Pencil, Replace, Send, ShoppingBasket, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import { removeFromBasket, sendBasket } from '../hooks/bridge-actions';
import { answerTextOf, entryLinesOf, footOf, isStruckOut, sentSummaryOf, type BasketFoot, type BasketItem, type BasketView, type EntryLine, type Words } from '../services/basket';
import { clockTimeOf } from '../services/clock-time';
import { ActionButton } from '../ui/action-button';
import { Notice } from '../ui/notice';
import { ItemFocus, type ItemOpening } from './item-focus';

/** What the person is doing in the basket: removing one entry, or sending it. */
type Working = { kind: 'remove'; questionId: string } | { kind: 'send' };

const LINE_ICONS = {
  sent: CircleCheck,
  sending: LoaderCircle,
  next: Clock,
  unanswered: LoaderCircle,
  refused: CircleAlert,
  withdrawn: Ban,
  replaced: Replace,
  elsewhere: Check,
} as const;

const LINE_TONES = {
  ok: 'text-tone-ok-fg',
  waiting: 'text-tone-waiting-fg',
  attention: 'text-tone-attention-fg',
  off: 'text-muted-foreground',
} as const;

/** Words as the desktop says them, and shorter on a phone. */
function Said({ words }: { words: Words }) {
  if (words.desktop === words.phone) {
    return <span>{words.desktop}</span>;
  }
  return (
    <>
      <span className="hidden sm:inline">{words.desktop}</span>
      <span className="sm:hidden">{words.phone}</span>
    </>
  );
}

/** The line under an entry, behind its icon in its tone. */
function EntryLineSaid({ line }: { line: EntryLine }) {
  const Icon = LINE_ICONS[line.icon];
  return (
    <p data-testid="bridge-basket-standing" className="col-span-2 col-start-2 flex items-start gap-1.5 text-meta">
      <Icon aria-hidden className={`mt-0.5 size-3.5 shrink-0 ${LINE_TONES[line.tone]}`} />
      <span>
        <Said words={line.words} />
      </span>
    </p>
  );
}

/** One entry: the question, its asker and when it asked, its answer and note, the line saying how it stands, and what can be done with it. */
function BasketEntryRow({ entry, line, opening, working, onRemove }: { entry: BasketItem; line: EntryLine | undefined; opening: ItemOpening; working: Working | undefined; onRemove: (questionId: string) => void }) {
  const { standing } = entry;
  const isStruck = isStruckOut(standing);
  const isWorking = working !== undefined || opening.openingId !== undefined;
  const isRemoving = working?.kind === 'remove' && working.questionId === entry.questionId;
  const replacementId = standing.kind === 'replaced' ? standing.replacementId : null;
  const struck = isStruck ? 'line-through decoration-muted-foreground' : '';
  return (
    <li data-testid="bridge-basket-entry" data-standing={standing.kind} className={`grid grid-cols-[18px_1fr_auto] items-start gap-x-2.5 gap-y-1.5 border-t border-border p-3 first:border-t-0 sm:px-3.5 ${isStruck ? 'bg-muted' : ''}`}>
      <CircleQuestionMark aria-hidden className="mt-0.5 size-4 text-tone-active-fg" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={`font-medium ${struck}`}>{entry.title}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
          <span>
            to <b className="font-medium text-foreground">{entry.from}</b>
          </span>
          <span aria-hidden className="hidden text-border sm:inline">
            ·
          </span>
          <span className="hidden sm:inline">
            asked at <time dateTime={entry.sentAt}>{clockTimeOf(entry.sentAt)}</time>
          </span>
        </span>
        <span className={`${isStruck ? 'hidden sm:flex' : 'flex'} items-center gap-1.5 text-meta ${struck}`}>
          <ArrowRight aria-hidden className="size-3.5 shrink-0 text-primary" />
          {answerTextOf(entry)}
        </span>
        {entry.note === null ? null : <span className="text-caption italic text-muted-foreground">&quot;{entry.note}&quot;</span>}
      </div>
      {standing.kind === 'waiting' ? (
        <div className="flex items-center gap-1.5">
          <ActionButton data-testid="bridge-basket-change" size="sm" aria-label="Change" isPending={opening.openingId === entry.deliveryId} pendingLabel="Opening..." disabled={isWorking} onClick={() => { opening.open({ deliveryId: entry.deliveryId, job: 'decide', inBasket: { option: entry.option, note: entry.note } }); }}>
            <Pencil aria-hidden className="size-3.5" />
            <span className="hidden sm:inline">Change</span>
          </ActionButton>
          <ActionButton data-testid="bridge-basket-remove" size="sm" variant="ghost" aria-label="Remove" isPending={isRemoving} pendingLabel="Removing..." disabled={isWorking} onClick={() => { onRemove(entry.questionId); }}>
            <X aria-hidden className="size-4 sm:hidden" />
            <span className="hidden sm:inline">Remove</span>
          </ActionButton>
        </div>
      ) : (
        <span />
      )}
      {line === undefined ? null : <EntryLineSaid line={line} />}
      {opening.failure?.deliveryId === entry.deliveryId ? (
        <div className="col-span-2 col-start-2">
          <Notice message={opening.failure.message} isFailure />
        </div>
      ) : null}
      {standing.kind === 'withdrawn' || standing.kind === 'replaced' || standing.kind === 'dealtElsewhere' || standing.kind === 'refused' ? (
        <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-1.5">
          {replacementId === null ? null : (
            <ActionButton data-testid="bridge-replacement" size="sm" isPending={opening.openingId === replacementId} pendingLabel="Opening..." disabled={isWorking} onClick={() => { opening.open({ deliveryId: replacementId, job: 'decide' }); }}>
              <ArrowRight aria-hidden className="size-3.5" />
              Answer the new question
            </ActionButton>
          )}
          <ActionButton data-testid="bridge-basket-remove" size="sm" variant={standing.kind === 'replaced' ? 'ghost' : 'secondary'} isPending={isRemoving} pendingLabel="Removing..." disabled={isWorking} onClick={() => { onRemove(entry.questionId); }}>
            {standing.kind === 'refused' ? 'Remove and mark done' : 'Remove'}
          </ActionButton>
        </div>
      ) : null}
    </li>
  );
}

/** The foot of the basket: Send naming the ships, the send going on, or what came of it. */
function BasketFootBar({ foot, isSending, isWorking, onSend }: { foot: BasketFoot; isSending: boolean; isWorking: boolean; onSend: () => void }) {
  if (foot.kind === 'none') {
    return null;
  }
  return (
    <div data-testid="bridge-basket-foot" className="flex flex-col items-stretch gap-2 border-t border-border bg-card p-3 sm:flex-row sm:items-center sm:gap-3 sm:px-3.5">
      <p className="flex-1 text-caption text-muted-foreground">
        <Said words={foot.words} />
      </p>
      {foot.kind === 'send' ? (
        <ActionButton data-testid="bridge-basket-send" variant="primary" className="justify-center" isPending={isSending} pendingLabel="Sending..." disabled={isWorking} onClick={onSend}>
          <Send aria-hidden className="size-4" />
          {foot.label}
        </ActionButton>
      ) : null}
      {foot.kind === 'sending' ? (
        <button type="button" data-testid="bridge-basket-sending" disabled aria-busy="true" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 font-medium text-card-foreground">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {foot.progress}
        </button>
      ) : null}
    </div>
  );
}

/** What was sent, over the empty basket, once every entry left was sent. */
function SentSummary({ summary }: { summary: { title: string; description: string } }) {
  return (
    <div data-testid="bridge-basket-sent" role="status" className="flex max-w-[620px] items-start gap-3 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg">
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-tone-ok-fg" />
      <span className="grid gap-1">
        <span className="font-medium">{summary.title}</span>
        <span className="text-caption text-muted-foreground">{summary.description}</span>
      </span>
    </div>
  );
}

/** The empty basket, with what goes into it. */
function EmptyBasket() {
  return (
    <div data-testid="bridge-basket-empty" className="grid max-w-[820px] justify-items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
      <span className="inline-flex size-11 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
        <ShoppingBasket aria-hidden className="size-5" />
      </span>
      <span className="text-heading font-semibold">The basket is empty</span>
      <span className="max-w-[360px] text-muted-foreground">Pick an option on a question and put it in the basket; it waits here until you send it.</span>
    </div>
  );
}

/**
 * The basket open (docs/design/bridge, section 9; basket.html, basket-3 to
 * basket-7): its count of what is or will be sent, and the answers the
 * person picked in Bridge, in the order added, each with its answer by
 * number and label. Change opens the question with that option picked;
 * Remove takes the entry out, and the question still waits; one the fleet
 * refused is removed and its question marked done. A withdrawn, replaced or
 * answered-elsewhere entry is struck out and not sent. Send N answers stores
 * each as sending and the gateway sends them, each on its own: each entry
 * then says how it goes, and the foot Sending N of M, or what came of the
 * send once one was not answered or refused. Once every entry left was
 * sent, what was sent stands over the empty basket.
 */
export function BasketPanel({ fleetId, basket }: { fleetId: string; basket: BasketView }) {
  const [working, setWorking] = useState<Working | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [, startTransition] = useTransition();
  const lines = entryLinesOf(basket);
  const summary = sentSummaryOf(basket);

  const remove = (questionId: string) => {
    setWorking({ kind: 'remove', questionId });
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await removeFromBasket(fleetId, questionId);
      setWorking(undefined);
      setFailure(outcome.isOk ? undefined : outcome.message);
    });
  };

  const send = () => {
    setWorking({ kind: 'send' });
    setFailure(undefined);
    startTransition(async () => {
      const outcome = await sendBasket(fleetId);
      setWorking(undefined);
      setFailure(outcome.isOk ? undefined : outcome.message);
    });
  };

  return (
    <ItemFocus fleetId={fleetId}>
      {(opening) => (
        <section className="grid gap-4" aria-labelledby="bridge-basket-heading">
          <div>
            <h1 id="bridge-basket-heading" className="text-heading font-semibold">
              Basket <span data-testid="bridge-basket-count" className="text-primary">{basket.count}</span>
            </h1>
            <p className="text-caption text-muted-foreground">Answers you picked in Bridge, not sent yet. Nothing goes until you press Send.</p>
          </div>
          {failure === undefined ? null : <Notice message={failure} isFailure />}
          {summary === undefined ? null : <SentSummary summary={summary} />}
          {basket.entries.length === 0 || summary !== undefined ? (
            <EmptyBasket />
          ) : (
            <div className="max-w-[820px] overflow-hidden rounded-lg border border-border bg-card">
              <ul>
                {basket.entries.map((entry, index) => (
                  <BasketEntryRow key={entry.questionId} entry={entry} line={lines[index]} opening={opening} working={working} onRemove={remove} />
                ))}
              </ul>
              <BasketFootBar foot={footOf(basket)} isSending={working?.kind === 'send'} isWorking={working !== undefined || opening.openingId !== undefined} onSend={send} />
            </div>
          )}
        </section>
      )}
    </ItemFocus>
  );
}
