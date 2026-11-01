import { Check, ChevronLeft, CircleCheck, CircleX, ExternalLink, Info } from 'lucide-react';
import { useState } from 'react';

import type { Question } from '@aeolus-fleet/common';

import { staleSaidOf, type FocusedDelivery, type Stale, type StepView } from '../services/deliveries';
import { clockTimeOf, fromWordsOf, jobWordOf, screenTitleOf, seenWordsOf, type HomeItem } from '../services/items';
import { ActionButton } from './action-button';
import { jobLookOf } from './job-looks';
import { Markdown } from './markdown';
import { Notice } from './notice';
import { StaleIcon } from './stale-icon';

/** A phone shows only the first paragraph of what an item says, as the sheets draw it; a desktop shows it whole. */
export const PROSE = 'max-md:[&_p+p]:hidden';

/** Which of the card's controls is working: an option of the question put in the basket, its entry removed, the note alone, done, or a step's cannot. */
export type DeliveryControl = { kind: 'option'; option: number } | { kind: 'remove' } | { kind: 'note' } | { kind: 'done' } | { kind: 'cannot' };

/** How an item was opened: its job, whether a stay-aware one is an alert, and whether it was new until this opening. */
export interface Opened {
  readonly job: HomeItem['job'];
  readonly isAlert: boolean;
  readonly wasNew: boolean;
}

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

/** What a question in the basket says: in it, not sent, with its note; picking another option changes it. */
function InBasketNotice({ inBasket, basketHref, isRemoving, isWorking, onRemove }: { inBasket: InBasket; basketHref: string; isRemoving: boolean; isWorking: boolean; onRemove: () => void }) {
  return (
    <div data-testid="bridge-in-basket" className="grid gap-2 rounded-md border border-border bg-muted p-3">
      <span className="font-medium">In the basket: {inBasket.option === null ? 'the note alone' : `option ${String(inBasket.option)}`}, not sent</span>
      {inBasket.note === null ? null : <span className="text-caption">“{inBasket.note}”</span>}
      <span className="text-caption text-muted-foreground">Pick another option to change it.</span>
      <div className="flex flex-wrap gap-2">
        <a data-testid="bridge-basket-open" href={basketHref} className="inline-flex h-9 items-center rounded-md border border-border px-4 hover:bg-accent">
          Open the basket
        </a>
        <ActionButton data-testid="bridge-basket-remove" isPending={isRemoving} pendingLabel="Removing..." disabled={isWorking} onClick={onRemove}>
          Remove
        </ActionButton>
      </div>
    </div>
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
            {option.detail === '' ? null : <span className="text-caption text-muted-foreground max-md:hidden">{option.detail}</span>}
          </span>
          {option.key === question.pick.option ? <span className="rounded-sm border border-border px-1.5 text-caption">Their pick</span> : null}
        </label>
      ))}
      <label className={`flex items-start gap-3 rounded-md border p-3 ${chosen === null && !isStale ? 'border-ring bg-accent' : 'border-border'}`}>
        <input type="radio" name="option" value="" checked={chosen === null && !isStale} onChange={() => { onChoose(null); }} className="mt-1" />
        <span className="grid flex-1 gap-0.5">
          <span className="font-medium">No option, only the note</span>
          <span className="text-caption text-muted-foreground max-md:hidden">Answer with your note alone.</span>
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

function StaleNotice({ stale, from, isStep, timeZone, onOpen }: { stale: Stale; from: string; isStep: boolean; timeZone: string | undefined; onOpen: (deliveryId: string) => void }) {
  const { replacementId } = stale;
  const words = STALE_WORDS[isStep ? 'step' : 'question'];
  return (
    <div data-testid="bridge-stale" className="grid gap-2">
      <span className="flex items-center gap-1.5">
        <StaleIcon kind={stale.kind} />
        {`${staleSaidOf(stale, { from, clockOf: (at) => clockTimeOf(at, timeZone) })}. ${stale.kind === 'withdrawn' ? words.withdrawn : words.replaced}`}
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
export function StepAsked({ step, isStale, isFinished }: { step: StepView; isStale: boolean; isFinished: boolean }) {
  const { link } = step;
  return (
    <>
      <div className={PROSE}>
        <Markdown text={step.why} />
      </div>
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
function StepOutcomeNotice({ from, finished, timeZone }: { from: string; finished: StepFinished; timeZone: string | undefined }) {
  const isDone = finished.outcome === 'done';
  const Icon = isDone ? CircleCheck : CircleX;
  return (
    <div data-testid="bridge-step-outcome" role="status" className={`flex items-start gap-3 rounded-md border p-3 ${isDone ? 'border-tone-ok-border bg-tone-ok-bg' : 'border-tone-ended-border bg-tone-ended-bg'}`}>
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${isDone ? 'text-tone-ok-fg' : 'text-tone-ended-fg'}`} />
      <span className="grid gap-0.5">
        <span className="font-medium">{`${isDone ? 'Done in Bridge' : 'Cannot, in Bridge'} at ${clockTimeOf(finished.at, timeZone)}`}</span>
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
      <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>Done tells {from} you did it, Cannot that you could not; the note goes with either. Whether it worked is theirs to check.</span>
      </p>
    </>
  );
}

/** An opened item's heading (decide.html): its job's icon and word in its tone, who sent it, the time of day it arrived, and whether it was seen. */
export function ItemHeading({ delivery, opened, timeZone }: { delivery: Pick<FocusedDelivery, 'from' | 'sentAt'>; opened: Opened; timeZone: string | undefined }) {
  const look = jobLookOf(opened);
  const JobIcon = look.icon;
  const seen = seenWordsOf({ wasNew: opened.wasNew, isDoneOnSeeing: opened.job === 'stay-aware' });
  return (
    <p data-testid="bridge-item-heading" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
      <span className={`inline-flex items-center gap-1 font-medium ${look.tone}`}>
        <JobIcon aria-hidden="true" className="size-3.5" />
        {jobWordOf(opened)}
      </span>
      <Separator />
      <span>
        {fromWordsOf(opened)} <strong className="font-semibold text-foreground">{delivery.from}</strong>
      </span>
      <Separator />
      <time dateTime={delivery.sentAt}>{clockTimeOf(delivery.sentAt, timeZone)}</time>
      {seen === undefined ? null : (
        <>
          <Separator />
          <span>{seen}</span>
        </>
      )}
    </p>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-border">
      ·
    </span>
  );
}

/** An opened item's own screen on a phone: back to the list by its chevron, titled by its job (decide.html, do.html). A desktop shows the list beside it instead. */
export function ScreenBar({ opened, isWorking, onBack }: { opened: Opened; isWorking: boolean; onBack: () => void }) {
  return (
    <div data-testid="bridge-item-screen-bar" className="-mx-1 flex items-center gap-1 md:hidden">
      <button type="button" data-testid="bridge-back" aria-label="Back to the list" onClick={onBack} disabled={isWorking} className="inline-flex size-9 items-center justify-center rounded-md hover:bg-accent disabled:opacity-70">
        <ChevronLeft aria-hidden="true" className="size-5" />
      </button>
      <span className="text-section font-semibold">{screenTitleOf(opened)}</span>
    </div>
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
 * is done once seen (Bridge, CC16): it asks nothing more, and its heading
 * says so. So is a question its asker withdrew or replaced: stale, nothing
 * to send, a replaced one leading to its replacement. What it says is
 * Markdown; its times are the person's own (aeolus-fleet#1538).
 */
export function DeliveryCard({
  delivery,
  opened,
  timeZone,
  meetingHref,
  basketHref,
  inBasket,
  finished,
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
  onBack,
}: {
  delivery: FocusedDelivery;
  /** How it was opened: its job, whether an alert, and whether it was new. */
  opened: Opened;
  /** The time zone its times are said in: the browser's when none is named. */
  timeZone?: string;
  /** The page of the meeting it belongs to, if it belongs to one. */
  meetingHref: string | undefined;
  /** Bridge's basket. */
  basketHref: string;
  /** The answer to the question in the basket, if any. */
  inBasket: InBasket | null;
  /** How the person ended the step in Bridge, once they did. */
  finished: StepFinished | null;
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
  onBack: () => void;
}) {
  const { question, step, stale } = delivery;
  const [chosen, setChosen] = useState<number | null | undefined>(inBasket === null ? question?.pick.option : inBasket.option);
  const isWorking = working !== undefined;
  // Seeing an alert or a notice was all it asked, so it is done (CC16).
  const isDoneOnSeeing = opened.job === 'stay-aware';
  return (
    <section data-testid="bridge-delivery" className="grid min-w-0 content-start gap-3 text-card-foreground md:p-5">
      <ScreenBar opened={opened} isWorking={isWorking} onBack={onBack} />
      <ItemHeading delivery={delivery} opened={opened} timeZone={timeZone} />
      <h2 className="text-heading font-semibold">{stale === null ? (question?.title ?? delivery.title) : <s className="decoration-muted-foreground">{question?.title ?? delivery.title}</s>}</h2>
      {meetingHref === undefined ? null : (
        <a data-testid="bridge-meeting" href={meetingHref} className="inline-flex h-9 items-center justify-self-start rounded-md bg-primary px-4 text-primary-foreground hover:bg-primary-hover">
          Go to the meeting
        </a>
      )}
      {step !== undefined ? (
        <StepAsked step={step} isStale={stale !== null} isFinished={finished !== null} />
      ) : question === undefined ? (
        <Markdown text={delivery.body} />
      ) : (
        <>
          <div className={PROSE}>
            <Markdown text={question.context} />
          </div>
          <QuestionOptions question={question} chosen={chosen} isStale={stale !== null} onChoose={setChosen} />
          <p className="text-caption text-muted-foreground">
            {delivery.from} picks {question.pick.option}: {question.pick.why}
          </p>
        </>
      )}
      {stale === null ? null : <StaleNotice stale={stale} from={delivery.from} isStep={step !== undefined} timeZone={timeZone} onOpen={onOpen} />}
      {inBasket === null || stale !== null ? null : <InBasketNotice inBasket={inBasket} basketHref={basketHref} isRemoving={working?.kind === 'remove'} isWorking={isWorking} onRemove={onRemove} />}
      {isDoneOnSeeing ? null : stale !== null ? null : step !== undefined ? (
        finished === null ? <StepControls from={delivery.from} note={note} working={working} failure={failure} onNoteChange={onNoteChange} onFinish={onFinishStep} /> : <StepOutcomeNotice from={delivery.from} finished={finished} timeZone={timeZone} />
      ) : (
        <>
          <label className="grid gap-1">
            <span>{question === undefined ? 'Your answer' : 'Note'}</span>
            <textarea
              data-testid="bridge-note"
              rows={2}
              value={note}
              onChange={(event) => { onNoteChange(event.target.value); }}
              placeholder={question === undefined ? '' : 'Optional, goes with the answer'}
              className="rounded-md border border-input bg-background p-2"
            />
          </label>
          {failure === undefined ? null : <Notice message={failure} isFailure />}
          {question === undefined ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton data-testid="bridge-answer" variant="primary" isPending={working?.kind === 'note'} pendingLabel="Sending..." disabled={isWorking} onClick={() => { onAnswer(undefined); }}>
                Answer
              </ActionButton>
              <ActionButton data-testid="bridge-done" isPending={working?.kind === 'done'} pendingLabel="Marking done..." disabled={isWorking} onClick={onDone}>
                Done
              </ActionButton>
            </div>
          ) : chosen === undefined ? null : (
            <div className="grid gap-1">
              <ActionButton data-testid="bridge-put-in-basket" variant="primary" className="justify-self-start" isPending={working?.kind === (chosen === null ? 'note' : 'option')} pendingLabel="Putting in the basket..." disabled={isWorking || (chosen === null && note.trim() === '')} onClick={() => { onPut(chosen); }}>
                {chosen === null ? 'Put the note alone in the basket' : `Put option ${String(chosen)} in the basket`}
              </ActionButton>
              <span className="text-caption text-muted-foreground">Nothing is sent yet. {delivery.from} receives this answer when you send the basket.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
