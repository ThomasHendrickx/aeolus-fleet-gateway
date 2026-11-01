import { useState } from 'react';

import type { Question } from '@aeolus-fleet/common';

import type { FocusedDelivery, Stale, StepView } from '../services/deliveries';
import { ActionButton } from './action-button';
import { Notice } from './notice';

/** Which of the card's controls is working: an option of the question put in the basket, its entry removed, the note alone, done, or a step's cannot. */
export type DeliveryControl = { kind: 'option'; option: number } | { kind: 'remove' } | { kind: 'note' } | { kind: 'done' } | { kind: 'cannot' };

/** How the person ends a step: they did it, or cannot. */
export type StepOutcome = 'done' | 'cannot';

/** The answer to a question in the basket (Bridge, section 9): its option, none for a note alone, and its note, none when the person wrote none. */
export interface InBasket {
  readonly option: number | null;
  readonly note: string | null;
}

/** What a question in the basket says: in it, not sent, with its note; picking another option changes it. */
function InBasketNotice({ inBasket, basketHref, isRemoving, isWorking, onRemove }: { inBasket: InBasket; basketHref: string; isRemoving: boolean; isWorking: boolean; onRemove: () => void }) {
  return (
    <div data-testid="bridge-in-basket" className="grid gap-2 rounded-md border border-border bg-muted p-3">
      <span className="font-medium">In the basket: option {inBasket.option}, not sent</span>
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

/** The options of a question, one to choose, the asker's pick marked; none to choose once it is stale. */
function QuestionOptions({ question, chosen, isStale, onChoose }: { question: Question; chosen: number | undefined; isStale: boolean; onChoose: (option: number) => void }) {
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
    </fieldset>
  );
}

/** What a stale question says: withdrawn, done; or replaced, with the replacement to open. */
function StaleNotice({ stale, from, onOpen }: { stale: Stale; from: string; onOpen: (deliveryId: string) => void }) {
  const { replacementId } = stale;
  return (
    <div data-testid="bridge-stale" className="grid gap-2 rounded-md border border-border bg-muted p-3">
      <span>{stale.kind === 'withdrawn' ? `Withdrawn by ${from}. Nothing to answer: it is done.` : `Replaced by ${from}. Answer the new question.`}</span>
      {replacementId === null ? null : (
        <ActionButton data-testid="bridge-replacement" className="justify-self-start" isPending={false} pendingLabel="Opening..." onClick={() => { onOpen(replacementId); }}>
          Open the new question
        </ActionButton>
      )}
    </div>
  );
}

/** What a step asks: why, and the link where it is done, shown with its host and opened only by the person's own press (Bridge, section 9). */
function StepAsked({ step }: { step: StepView }) {
  return (
    <>
      <p className="whitespace-pre-wrap">{step.why}</p>
      {step.link === undefined ? null : (
        <a data-testid="bridge-step-link" href={step.link.href} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center justify-self-start rounded-md border border-border px-4 hover:bg-accent">
          Open on {step.link.host}
        </a>
      )}
    </>
  );
}

/** A step's note field, shown before Done or Cannot is pressed, and the two: the outcome goes to the asker at once, with the note (CC14, CC23). */
function StepControls({ from, note, working, failure, onNoteChange, onFinish }: { from: string; note: string; working: DeliveryControl | undefined; failure: string | undefined; onNoteChange: (note: string) => void; onFinish: (outcome: StepOutcome) => void }) {
  const isWorking = working !== undefined;
  return (
    <>
      <label className="grid gap-1">
        <span>Note</span>
        <textarea
          data-testid="bridge-note"
          rows={2}
          value={note}
          onChange={(event) => { onNoteChange(event.target.value); }}
          placeholder="Optional, goes with Done or Cannot"
          className="rounded-md border border-input bg-background p-2"
        />
      </label>
      {failure === undefined ? null : <Notice message={failure} isFailure />}
      <div className="grid gap-1">
        <div className="flex flex-wrap gap-2">
          <ActionButton data-testid="bridge-step-done" variant="primary" isPending={working?.kind === 'done'} pendingLabel="Sending..." disabled={isWorking} onClick={() => { onFinish('done'); }}>
            Done
          </ActionButton>
          <ActionButton data-testid="bridge-step-cannot" isPending={working?.kind === 'cannot'} pendingLabel="Sending..." disabled={isWorking} onClick={() => { onFinish('cannot'); }}>
            Cannot
          </ActionButton>
        </div>
        <span className="text-caption text-muted-foreground">{from} is told at once, with your note.</span>
      </div>
    </>
  );
}

/**
 * One item in focus (design B, Signal). A question opens with the asker's
 * pick chosen (CC11), or the option in the basket; its one button puts that
 * option in the basket with the note, if any, and sends nothing (CC24): the
 * person sends the basket. A step (CC14) shows why and its link, then its
 * note field before Done and Cannot, each sending its outcome at once with
 * the note. Any other item may get a note as its answer, and may
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
  /** Whether seeing it was all it asked, so it is done: an alert or a notice. */
  isDoneOnSeeing: boolean;
  /** The page of the meeting it belongs to, if it belongs to one. */
  meetingHref: string | undefined;
  /** Bridge's basket. */
  basketHref: string;
  /** The answer to the question in the basket, if any. */
  inBasket: InBasket | null;
  note: string;
  working: DeliveryControl | undefined;
  failure: string | undefined;
  onNoteChange: (note: string) => void;
  /** Answers any item but a question with the note. */
  onAnswer: (option: number | undefined) => void;
  /** Puts the option chosen of a question in the basket, with the note. */
  onPut: (option: number) => void;
  /** Takes the question's answer out of the basket. */
  onRemove: () => void;
  onDone: () => void;
  /** Ends a step done or cannot, with the note. */
  onFinishStep: (outcome: StepOutcome) => void;
  /** Opens another item: a replaced question's replacement. */
  onOpen: (deliveryId: string) => void;
  onBack: () => void;
}) {
  const { question, step, stale } = delivery;
  const [chosen, setChosen] = useState(inBasket?.option ?? question?.pick.option);
  const isWorking = working !== undefined;
  return (
    <section data-testid="bridge-delivery" className="grid gap-3 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <span className="text-caption text-muted-foreground">
        {delivery.from} · {new Date(delivery.sentAt).toUTCString()}
      </span>
      <h2 className="text-heading font-semibold">{question?.title ?? delivery.title}</h2>
      {meetingHref === undefined ? null : (
        <a data-testid="bridge-meeting" href={meetingHref} className="inline-flex h-9 items-center justify-self-start rounded-md bg-primary px-4 text-primary-foreground hover:bg-primary-hover">
          Go to the meeting
        </a>
      )}
      {step !== undefined ? (
        <StepAsked step={step} />
      ) : question === undefined ? (
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-caption">{delivery.body}</pre>
      ) : (
        <>
          <p className="whitespace-pre-wrap">{question.context}</p>
          <QuestionOptions question={question} chosen={chosen} isStale={stale !== null} onChoose={setChosen} />
          <p className="text-caption text-muted-foreground">
            {delivery.from} picks {question.pick.option}: {question.pick.why}
          </p>
        </>
      )}
      {stale === null ? null : <StaleNotice stale={stale} from={delivery.from} onOpen={onOpen} />}
      {inBasket === null || stale !== null ? null : <InBasketNotice inBasket={inBasket} basketHref={basketHref} isRemoving={working?.kind === 'remove'} isWorking={isWorking} onRemove={onRemove} />}
      {isDoneOnSeeing ? (
        <p data-testid="bridge-seen-done" className="text-muted-foreground">
          Seen now, so done: it asks nothing more.
        </p>
      ) : stale !== null ? null : step !== undefined ? (
        <StepControls from={delivery.from} note={note} working={working} failure={failure} onNoteChange={onNoteChange} onFinish={onFinishStep} />
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
              <ActionButton data-testid="bridge-put-in-basket" variant="primary" className="justify-self-start" isPending={working?.kind === 'option'} pendingLabel="Putting in the basket..." disabled={isWorking} onClick={() => { onPut(chosen); }}>
                Put option {chosen} in the basket
              </ActionButton>
              <span className="text-caption text-muted-foreground">Nothing is sent yet. {delivery.from} receives this answer when you send the basket.</span>
            </div>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onBack} disabled={isWorking} className="inline-flex h-9 items-center rounded-md px-4 text-muted-foreground hover:bg-accent disabled:opacity-70">
          Back
        </button>
      </div>
    </section>
  );
}
