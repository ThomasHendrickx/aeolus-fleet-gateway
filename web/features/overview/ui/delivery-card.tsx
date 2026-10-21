import type { FocusedDelivery } from '../services/deliveries';
import { ActionButton } from './action-button';
import { Notice } from './notice';

/** Which of the card's controls is working: an option of the question, the note alone, or done. */
export type DeliveryControl = { kind: 'option'; option: number } | { kind: 'note' } | { kind: 'done' };

/**
 * One delivery in focus (design B, Signal). A question is answered with one
 * tap on a button that names the option it sends, the asker's pick on a
 * dashed edge; any delivery may get a note as its answer, and a message may
 * be done with. Opened before, it shows by its title alone, as its content
 * was shown once.
 */
export function DeliveryCard({
  delivery,
  note,
  working,
  failure,
  onNoteChange,
  onAnswer,
  onDone,
  onBack,
}: {
  delivery: FocusedDelivery;
  note: string;
  working: DeliveryControl | undefined;
  failure: string | undefined;
  onNoteChange: (note: string) => void;
  onAnswer: (option: number | undefined) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const { question } = delivery;
  const isWorking = working !== undefined;
  const picked = question?.options.find((option) => option.key === question.pick.option);
  return (
    <section data-testid="overview-delivery" className="grid gap-3 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <span className="text-caption text-muted-foreground">
        {delivery.from} · {new Date(delivery.sentAt).toUTCString()}
      </span>
      <h2 className="text-heading font-semibold">{question?.title ?? delivery.title}</h2>
      {question === undefined ? (
        delivery.payload === undefined ? (
          <p className="text-muted-foreground">You opened this before; its content was shown to you then.</p>
        ) : (
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-caption">{delivery.payload}</pre>
        )
      ) : (
        <>
          <p className="whitespace-pre-wrap">{question.context}</p>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => (
              <ActionButton
                key={option.key}
                title={option.detail}
                variant={option.key === question.pick.option ? 'primary' : 'secondary'}
                className={option.key === question.pick.option ? 'outline-2 outline-offset-2 outline-dashed outline-ring' : ''}
                isPending={working?.kind === 'option' && working.option === option.key}
                pendingLabel="Sending..."
                disabled={isWorking}
                onClick={() => { onAnswer(option.key); }}
              >
                {option.label}
              </ActionButton>
            ))}
          </div>
          {picked === undefined ? null : (
            <p className="text-muted-foreground">
              {picked.label} is the pick of {delivery.from}: {question.pick.why}
            </p>
          )}
        </>
      )}
      <label className="grid gap-1">
        <span>{question === undefined ? 'Your answer' : 'Note'}</span>
        <textarea
          data-testid="overview-note"
          rows={2}
          value={note}
          onChange={(event) => { onNoteChange(event.target.value); }}
          placeholder={question === undefined ? '' : 'Optional, sent with your answer'}
          className="rounded-md border border-input bg-background p-2"
        />
      </label>
      {failure === undefined ? null : <Notice message={failure} isFailure />}
      <div className="flex flex-wrap gap-2">
        <ActionButton data-testid="overview-answer" variant={question === undefined ? 'primary' : 'secondary'} isPending={working?.kind === 'note'} pendingLabel="Sending..." disabled={isWorking} onClick={() => { onAnswer(undefined); }}>
          {question === undefined ? 'Answer' : 'Send the note alone'}
        </ActionButton>
        {question === undefined ? (
          <ActionButton data-testid="overview-done" isPending={working?.kind === 'done'} pendingLabel="Marking done..." disabled={isWorking} onClick={onDone}>
            Done
          </ActionButton>
        ) : null}
        <button type="button" onClick={onBack} disabled={isWorking} className="inline-flex h-9 items-center rounded-md px-4 text-muted-foreground hover:bg-accent disabled:opacity-70">
          Back to the inbox
        </button>
      </div>
    </section>
  );
}
