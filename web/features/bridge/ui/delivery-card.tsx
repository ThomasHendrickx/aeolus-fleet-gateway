import { Check, CircleCheck, CircleX, ExternalLink, Eye, Info, ShoppingBasket } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Send } from 'lucide-react';

import type { Question } from '@aeolus-fleet/common';

import { staleSaidOf, type FocusedDelivery, type Stale, type StepView } from '../services/deliveries';
import { clockTimeOf } from '../services/clock-time';
import { shownInOf, type RoutedPlace } from '../services/routing';
import { ActionButton } from './action-button';
import { Notice } from './notice';
import { StaleIcon } from './stale-icon';

/** Which of the card's controls is working: an option of the question put in the basket, its entry removed, the note alone, done, or a step's cannot. */
export type DeliveryControl = { kind: 'option'; option: number } | { kind: 'remove' } | { kind: 'note' } | { kind: 'done' } | { kind: 'cannot' };

/** How the person ends a step: they did it, or cannot. */
export type StepOutcome = 'done' | 'cannot';

/** A step the person ended in Bridge: how, with the note sent, empty for none, and when (ISO 8601). */
export interface StepFinished {
  readonly outcome: StepOutcome;
  readonly note: string;
  readonly at: string;
}

/** The answer to a question in the basket (Bridge, section 9): its option, none for a note alone, and its note, none when the person wrote none. */
export interface InBasket {
  readonly option: number | null;
  readonly note: string | null;
}

/** What the button under a question puts in the basket: its words, and whether it is ready to; nothing while no option is chosen or the choice is what the basket holds. */
export interface Put {
  readonly label: string;
  readonly isReady: boolean;
}

export function putOf({ chosen, inBasket, note }: { chosen: number | null | undefined; inBasket: InBasket | null; note: string }): Put | null {
  if (chosen === undefined || (inBasket !== null && inBasket.option === chosen)) {
    return null;
  }
  return chosen === null ? { label: 'Put the note alone in the basket', isReady: note.trim() !== '' } : { label: `Put option ${String(chosen)} in the basket`, isReady: true };
}

/** Which info lines a question says: the asker's pick while the choice is it and nothing is in the basket, or it is stale (decide-1); that nothing is sent yet once another option is chosen (basket-1); neither while the choice is what the basket holds (basket-2). */
export function infoLinesOf({ chosen, pick, inBasket, isStale }: { chosen: number | null | undefined; pick: number; inBasket: InBasket | null; isStale: boolean }): { isPickSaid: boolean; isNothingSentSaid: boolean } {
  if (isStale) {
    return { isPickSaid: true, isNothingSentSaid: false };
  }
  const isAtPick = inBasket === null && chosen === pick;
  return { isPickSaid: isAtPick, isNothingSentSaid: !isAtPick && putOf({ chosen, inBasket, note: '' }) !== null };
}

/** What a question in the basket says, in the info tone (basket.html): in it, not sent, with its note; picking another option changes it. */
function InBasketNotice({ inBasket, basketHref, isRemoving, isWorking, onRemove }: { inBasket: InBasket; basketHref: string; isRemoving: boolean; isWorking: boolean; onRemove: () => void }) {
  return (
    <div data-testid="bridge-in-basket" className="flex items-start gap-3 rounded-md border border-tone-active-border bg-tone-active-bg p-3">
      <ShoppingBasket aria-hidden className="mt-0.5 size-4 shrink-0 text-tone-active-fg" />
      <div className="grid flex-1 gap-2">
        <span className="grid gap-0.5">
          <span className="font-medium">In the basket: {inBasket.option === null ? 'the note alone' : `option ${String(inBasket.option)}`}, not sent</span>
          <span className="text-caption text-muted-foreground">{inBasket.note === null ? '' : `"${inBasket.note}" `}Pick another option to change it.</span>
        </span>
        <div className="flex flex-wrap gap-2">
          <a data-testid="bridge-basket-open" href={basketHref} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-card-foreground hover:bg-accent">
            Open the basket
          </a>
          <ActionButton data-testid="bridge-basket-remove" variant="ghost" isPending={isRemoving} pendingLabel="Removing..." disabled={isWorking} onClick={onRemove}>
            Remove
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

/** A line of the card said behind the info icon. */
function InfoLine({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** The options of a question, one to choose, the asker's pick marked, and No option, only the note, for a note alone; none to choose once it is stale. */
function QuestionOptions({ question, chosen, isStale, onChoose }: { question: Question; chosen: number | null | undefined; isStale: boolean; onChoose: (option: number | null) => void }) {
  return (
    <fieldset className={`grid gap-2 ${isStale ? 'opacity-60' : ''}`} disabled={isStale}>
      <legend className="sr-only">Options</legend>
      {question.options.map((option) => (
        <label key={option.key} className={`flex items-start gap-3 rounded-md border p-3 ${option.key === chosen && !isStale ? 'border-ring bg-accent' : 'border-border'}`}>
          <input type="radio" name="option" value={option.key} checked={option.key === chosen && !isStale} onChange={() => { onChoose(option.key); }} className="mt-1" />
          <span className="grid flex-1 gap-0.5">
            <span className="font-medium">
              {option.key}. {option.label}
            </span>
            {option.detail === '' ? null : <span className="text-caption text-muted-foreground">{option.detail}</span>}
          </span>
          {option.key === question.pick.option ? <span className="rounded-sm border border-border px-1.5 text-caption">Their pick</span> : null}
        </label>
      ))}
      <label className={`flex items-start gap-3 rounded-md border p-3 ${chosen === null && !isStale ? 'border-ring bg-accent' : 'border-border'}`}>
        <input type="radio" name="option" value="" checked={chosen === null && !isStale} onChange={() => { onChoose(null); }} className="mt-1" />
        <span className="grid flex-1 gap-0.5">
          <span className="font-medium">No option, only the note</span>
          <span className="text-caption text-muted-foreground">Answer with your note alone.</span>
        </span>
      </label>
    </fieldset>
  );
}

/** What a stale question or step says after who and when, in its words: withdrawn, done; or replaced, with the replacement to open. */
const STALE_WORDS = {
  question: { withdrawn: 'Nothing to answer: it is done.', replaced: 'Answer the new question.', open: 'Open the new question' },
  step: { withdrawn: 'Nothing to do: it is done.', replaced: 'Do the new step.', open: 'Open the new step' },
} as const;

function StaleNotice({ stale, from, isStep, onOpen }: { stale: Stale; from: string; isStep: boolean; onOpen: (deliveryId: string) => void }) {
  const { replacementId } = stale;
  const words = STALE_WORDS[isStep ? 'step' : 'question'];
  return (
    <div data-testid="bridge-stale" className="grid gap-2">
      <span className="flex items-center gap-1.5">
        <StaleIcon kind={stale.kind} />
        {`${staleSaidOf(stale, from)}. ${stale.kind === 'withdrawn' ? words.withdrawn : words.replaced}`}
      </span>
      {replacementId === null ? null : (
        <ActionButton data-testid="bridge-replacement" className="justify-self-start" isPending={false} pendingLabel="Opening..." onClick={() => { onOpen(replacementId); }}>
          {words.open}
        </ActionButton>
      )}
    </div>
  );
}

/** What a step asks: why, and the link where it is done in its box, with where it leads and whether that is outside Aeolus, opened only by the person's own Open; the box stays once the step is ended, without Open, and goes once it is stale (Bridge, section 9). */
function StepAsked({ step, isStale, isFinished }: { step: StepView; isStale: boolean; isFinished: boolean }) {
  const { link } = step;
  return (
    <>
      <p className="whitespace-pre-wrap">{step.why}</p>
      {link === undefined || isStale ? null : (
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <ExternalLink aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="grid flex-1">
            <span className="font-medium">Where it is done</span>
            <span className="font-mono text-caption text-muted-foreground">{link.isOutside ? `${link.address} · opens outside Aeolus` : link.address}</span>
          </span>
          {isFinished ? null : (
            <a data-testid="bridge-step-link" href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md border border-border px-3 hover:bg-accent">
              Open
            </a>
          )}
        </div>
      )}
    </>
  );
}

/** A step ended in Bridge, shown on the step: done in the ok tone, cannot in the ended tone, only the icon in the tone's colour, when, the note quoted and what was sent (do.html). */
function StepOutcomeNotice({ from, finished }: { from: string; finished: StepFinished }) {
  const isDone = finished.outcome === 'done';
  const Icon = isDone ? CircleCheck : CircleX;
  return (
    <div data-testid="bridge-step-outcome" role="status" className={`flex items-start gap-3 rounded-md border p-3 ${isDone ? 'border-tone-ok-border bg-tone-ok-bg' : 'border-tone-ended-border bg-tone-ended-bg'}`}>
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${isDone ? 'text-tone-ok-fg' : 'text-tone-ended-fg'}`} />
      <span className="grid gap-0.5">
        <span className="font-medium">{`${isDone ? 'Done in Bridge' : 'Cannot, in Bridge'} at ${clockTimeOf(finished.at)}`}</span>
        <span className="text-caption text-muted-foreground">
          {finished.note === '' ? '' : `“${finished.note}” `}
          {`Sent to ${from} as you, with the outcome ${finished.outcome}.`}
        </span>
      </span>
    </div>
  );
}

/** A step's note field, shown before Done or Cannot is pressed, and the two: the outcome goes to the asker at once, with the note (CC14, CC23). */
function StepControls({ from, note, working, failure, onNoteChange, onFinish }: { from: string; note: string; working: DeliveryControl | undefined; failure: string | undefined; onNoteChange: (note: string) => void; onFinish: (outcome: StepOutcome) => void }) {
  const isWorking = working !== undefined;
  return (
    <>
      <label className="grid max-w-2xl gap-1">
        <span>Note (optional)</span>
        <textarea
          data-testid="bridge-note"
          rows={2}
          value={note}
          onChange={(event) => { onNoteChange(event.target.value); }}
          placeholder={`Add a note for ${from}: what you did, or why you cannot`}
          className="field-sizing-content min-h-16 rounded-md border border-input bg-background p-2"
        />
        <span className="text-caption text-muted-foreground">Sent with Done or Cannot, whichever you press.</span>
      </label>
      {failure === undefined ? null : <Notice message={failure} isFailure />}
      <div className="flex flex-wrap gap-2">
        <ActionButton data-testid="bridge-step-done" variant="primary" isPending={working?.kind === 'done'} pendingLabel="Sending..." disabled={isWorking} onClick={() => { onFinish('done'); }}>
          <Check aria-hidden className="size-4" />
          Done
        </ActionButton>
        <ActionButton data-testid="bridge-step-cannot" isPending={working?.kind === 'cannot'} pendingLabel="Sending..." disabled={isWorking} onClick={() => { onFinish('cannot'); }}>
          Cannot
        </ActionButton>
      </div>
      <InfoLine>
        Done tells {from} you did it, Cannot that you could not; the note goes with either. Whether it worked is theirs to check.
      </InfoLine>
    </>
  );
}

/** A question's note field, always open (BH1), and the button putting the answer in the basket, sending nothing (CC24); neither while the choice is what the basket holds. */
function QuestionControls({ from, put, isNothingSentSaid, note, isPutting, isWorking, failure, onNoteChange, onPut }: { from: string; put: Put | null; isNothingSentSaid: boolean; note: string; isPutting: boolean; isWorking: boolean; failure: string | undefined; onNoteChange: (note: string) => void; onPut: () => void }) {
  if (put === null) {
    return null;
  }
  return (
    <>
      <label className="grid gap-1">
        <span>Note (optional)</span>
        <textarea data-testid="bridge-note" rows={2} value={note} onChange={(event) => { onNoteChange(event.target.value); }} className="field-sizing-content min-h-16 resize-none rounded-md border border-input bg-background p-2" />
        <span className="text-caption text-muted-foreground">Goes with the answer.</span>
      </label>
      {failure === undefined ? null : <Notice message={failure} isFailure />}
      <ActionButton data-testid="bridge-put-in-basket" variant="primary" className="w-full justify-center sm:w-auto sm:justify-self-start" isPending={isPutting} pendingLabel="Putting in the basket..." disabled={isWorking || !put.isReady} onClick={onPut}>
        <ShoppingBasket aria-hidden className="size-4" />
        {put.label}
      </ActionButton>
      {isNothingSentSaid ? <InfoLine>Nothing is sent yet. {from} receives this answer when you send the basket.</InfoLine> : null}
    </>
  );
}

/** Sends the ship an opened alert is about a message, the form opening with its ship filled in (aeolus-fleet #1547). */
function SendShipButton({ ship, onSendMessage }: { ship: string; onSendMessage: (alertShip: string) => void }) {
  return (
    <button type="button" data-testid="bridge-send-alert-ship" onClick={() => { onSendMessage(ship); }} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-3 font-semibold hover:bg-accent sm:h-9 sm:w-auto sm:justify-self-start">
      <Send aria-hidden="true" className="size-4" />
      Send {ship} a message
    </button>
  );
}

/**
 * One item in focus (design B, Signal). A question opens with the asker's
 * pick chosen (CC11), or what is in the basket; its one button puts that
 * option in the basket with the note, if any, or, with No option, only the
 * note chosen, the note alone, and sends nothing (CC24): the person sends
 * the basket. A step (CC14) shows why and its link, then its
 * note field before Done and Cannot, each sending its outcome at once with
 * the note; once sent, the step shows its outcome in place of them. Any other item may get a note as its answer, and may
 * be done with; one of a meeting leads to the meeting. An alert or a notice
 * is done once seen (Bridge, CC16): it asks nothing more. So is a question
 * its asker withdrew or replaced: stale, nothing to send, a replaced one
 * leading to its replacement.
 */
export function DeliveryCard({
  delivery,
  isDoneOnSeeing,
  meetingHref,
  basketHref,
  inBasket,
  finished,
  places,
  note,
  working,
  failure,
  onNoteChange,
  onAnswer,
  onPut,
  onRemove,
  onDone,
  onFinishStep,
  onOpen,
  onSendMessage,
  onBack,
}: {
  delivery: FocusedDelivery;
  /** Whether seeing it was all it asked, so it is done: an alert or a notice. */
  isDoneOnSeeing: boolean;
  /** The page of the meeting it belongs to, if it belongs to one. */
  meetingHref: string | undefined;
  /** Bridge's basket. */
  basketHref: string;
  /** The answer to the question in the basket, if any. */
  inBasket: InBasket | null;
  /** How the person ended the step in Bridge, once they did. */
  finished: StepFinished | null;
  /** The places besides Bridge that show a question, when the page read them. */
  places: readonly RoutedPlace[] | undefined;
  note: string;
  working: DeliveryControl | undefined;
  failure: string | undefined;
  onNoteChange: (note: string) => void;
  /** Answers any item but a question with the note. */
  onAnswer: (option: number | undefined) => void;
  /** Puts the option chosen of a question in the basket, with the note, or the note alone. */
  onPut: (option: number | null) => void;
  /** Takes the question's answer out of the basket. */
  onRemove: () => void;
  onDone: () => void;
  /** Ends a step done or cannot, with the note. */
  onFinishStep: (outcome: StepOutcome) => void;
  /** Opens another item: a replaced question's or step's replacement. */
  onOpen: (deliveryId: string) => void;
  /** Opens the form to send an alert's ship a message, its ship filled in; unset where the item is no alert. */
  onSendMessage?: ((alertShip: string) => void) | undefined;
  onBack: () => void;
}) {
  const { question, step, stale } = delivery;
  const [chosen, setChosen] = useState<number | null | undefined>(inBasket === null ? question?.pick.option : inBasket.option);
  const isWorking = working !== undefined;
  const infoLines = question === undefined ? undefined : infoLinesOf({ chosen, pick: question.pick.option, inBasket, isStale: stale !== null });
  return (
    <section data-testid="bridge-delivery" className="grid gap-3 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <span className="text-caption text-muted-foreground">
        {delivery.from} · {new Date(delivery.sentAt).toUTCString()}
      </span>
      <h2 className="text-heading font-semibold">{stale === null ? (question?.title ?? delivery.title) : <s className="decoration-muted-foreground">{question?.title ?? delivery.title}</s>}</h2>
      {meetingHref === undefined ? null : (
        <a data-testid="bridge-meeting" href={meetingHref} className="inline-flex h-9 items-center justify-self-start rounded-md bg-primary px-4 text-primary-foreground hover:bg-primary-hover">
          Go to the meeting
        </a>
      )}
      {step !== undefined ? (
        <StepAsked step={step} isStale={stale !== null} isFinished={finished !== null} />
      ) : question === undefined ? (
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-caption">{delivery.body}</pre>
      ) : (
        <>
          <p className="whitespace-pre-wrap">{question.context}</p>
          <QuestionOptions question={question} chosen={chosen} isStale={stale !== null} onChoose={setChosen} />
          {infoLines?.isPickSaid === true ? (
            <InfoLine>
              {delivery.from} picks {question.pick.option}: {question.pick.why}
            </InfoLine>
          ) : null}
        </>
      )}
      {stale === null ? null : <StaleNotice stale={stale} from={delivery.from} isStep={step !== undefined} onOpen={onOpen} />}
      {inBasket === null || stale !== null ? null : <InBasketNotice inBasket={inBasket} basketHref={basketHref} isRemoving={working?.kind === 'remove'} isWorking={isWorking} onRemove={onRemove} />}
      {isDoneOnSeeing && delivery.alertShip !== undefined && onSendMessage !== undefined ? <SendShipButton ship={delivery.alertShip} onSendMessage={onSendMessage} /> : null}
      {isDoneOnSeeing ? (
        <p data-testid="bridge-seen-done" className="text-muted-foreground">
          Seen now, so done: it asks nothing more.
        </p>
      ) : stale !== null ? null : step !== undefined ? (
        finished === null ? <StepControls from={delivery.from} note={note} working={working} failure={failure} onNoteChange={onNoteChange} onFinish={onFinishStep} /> : <StepOutcomeNotice from={delivery.from} finished={finished} />
      ) : question === undefined ? (
        <>
          <label className="grid gap-1">
            <span>Your answer</span>
            <textarea data-testid="bridge-note" rows={2} value={note} onChange={(event) => { onNoteChange(event.target.value); }} className="rounded-md border border-input bg-background p-2" />
          </label>
          {failure === undefined ? null : <Notice message={failure} isFailure />}
          <div className="flex flex-wrap gap-2">
            <ActionButton data-testid="bridge-answer" variant="primary" isPending={working?.kind === 'note'} pendingLabel="Sending..." disabled={isWorking} onClick={() => { onAnswer(undefined); }}>
              Answer
            </ActionButton>
            <ActionButton data-testid="bridge-done" isPending={working?.kind === 'done'} pendingLabel="Marking done..." disabled={isWorking} onClick={onDone}>
              Done
            </ActionButton>
          </div>
        </>
      ) : (
        <QuestionControls from={delivery.from} put={putOf({ chosen, inBasket, note })} isNothingSentSaid={infoLines?.isNothingSentSaid === true} note={note} isPutting={working?.kind === (chosen === null ? 'note' : 'option')} isWorking={isWorking} failure={failure} onNoteChange={onNoteChange} onPut={() => { if (chosen !== undefined) { onPut(chosen); } }} />
      )}
      {question === undefined || stale !== null || places === undefined ? null : (
        <footer data-testid="bridge-shown-in" className="grid gap-1 border-t border-border pt-3 text-caption text-muted-foreground">
          <Eye aria-hidden className="size-4" />
          <span>{shownInOf(places)}</span>
        </footer>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onBack} disabled={isWorking} className="inline-flex h-9 items-center rounded-md px-4 text-muted-foreground hover:bg-accent disabled:opacity-70">
          Back
        </button>
      </div>
    </section>
  );
}
