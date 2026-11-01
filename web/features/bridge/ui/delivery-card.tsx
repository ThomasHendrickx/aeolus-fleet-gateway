import { useState } from 'react';

import type { Question } from '@aeolus-fleet/common';

import type { FocusedDelivery, Stale } from '../services/deliveries';
import { ActionButton } from './action-button';
import { Notice } from './notice';

/** Which of the card's controls is working: an option of the question, the note alone, or done. */
export type DeliveryControl = { kind: 'option'; option: number } | { kind: 'note' } | { kind: 'done' };

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

/**
 * One item in focus (design B, Signal). A question opens with the asker's
 * pick chosen (CC11); one button names the option it sends, and a note may
 * go with it or alone. Any other item may get a note as its answer, and may
 * be done with; one of a meeting leads to the meeting. An alert or a notice
 * is done once seen (Bridge, CC16): it asks nothing more. So is a question
 * its asker withdrew or replaced: stale, nothing to send, a replaced one
 * leading to its replacement.
 */
export function DeliveryCard({
  delivery,
  isDoneOnSeeing,
  meetingHref,
  note,
  working,
  failure,
  onNoteChange,
  onAnswer,
  onDone,
  onOpen,
  onBack,
}: {
  delivery: FocusedDelivery;
  /** Whether seeing it was all it asked, so it is done: an alert or a notice. */
  isDoneOnSeeing: boolean;
  /** The page of the meeting it belongs to, if it belongs to one. */
  meetingHref: string | undefined;
  note: string;
  working: DeliveryControl | undefined;
  failure: string | undefined;
  onNoteChange: (note: string) => void;
  onAnswer: (option: number | undefined) => void;
  onDone: () => void;
  /** Opens another item: a replaced question's replacement. */
  onOpen: (deliveryId: string) => void;
  onBack: () => void;
}) {
  const { question, stale } = delivery;
  const [chosen, setChosen] = useState(question?.pick.option);
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
      {question === undefined ? (
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
      {isDoneOnSeeing ? (
        <p data-testid="bridge-seen-done" className="text-muted-foreground">
          Seen now, so done: it asks nothing more.
        </p>
      ) : stale !== null ? null : (
        <>
          <label className="grid gap-1">
            <span>{question === undefined ? 'Your answer' : 'Note'}</span>
            <textarea
              data-testid="bridge-note"
              rows={2}
              value={note}
              onChange={(event) => { onNoteChange(event.target.value); }}
              placeholder={question === undefined ? '' : 'Optional, sent with your answer'}
              className="rounded-md border border-input bg-background p-2"
            />
          </label>
          {failure === undefined ? null : <Notice message={failure} isFailure />}
          <div className="flex flex-wrap gap-2">
            {question === undefined || chosen === undefined ? null : (
              <ActionButton data-testid="bridge-send-option" variant="primary" isPending={working?.kind === 'option'} pendingLabel="Sending..." disabled={isWorking} onClick={() => { onAnswer(chosen); }}>
                Send option {chosen}
              </ActionButton>
            )}
            <ActionButton data-testid="bridge-answer" variant={question === undefined ? 'primary' : 'secondary'} isPending={working?.kind === 'note'} pendingLabel="Sending..." disabled={isWorking} onClick={() => { onAnswer(undefined); }}>
              {question === undefined ? 'Answer' : 'Send the note alone'}
            </ActionButton>
            {question === undefined ? (
              <ActionButton data-testid="bridge-done" isPending={working?.kind === 'done'} pendingLabel="Marking done..." disabled={isWorking} onClick={onDone}>
                Done
              </ActionButton>
            ) : null}
          </div>
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
