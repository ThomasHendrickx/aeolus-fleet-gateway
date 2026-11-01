import { CircleCheck, CircleX } from 'lucide-react';

import type { Question } from '@aeolus-fleet/common';

import { bodyOf, questionOf, stepOf } from '../services/deliveries';
import { endedOf, endedTitleOf, historyOf, type RecordItem } from '../services/items';
import { ItemHeading, PROSE, ScreenBar, StepAsked } from './delivery-card';
import { Markdown } from './markdown';

/** A done question's options as they stood: each with its radio, filled on the one answered, framed by the ring; the asker's pick named; none to choose. */
function AnsweredOptions({ question, answered }: { question: Question; answered: number | null }) {
  return (
    <ul className="grid gap-2" aria-label="Options">
      {question.options.map((option) => {
        const isAnswered = option.key === answered;
        return (
          <li key={option.key} data-answered={isAnswered} className={`flex items-start gap-3 rounded-md border p-3 ${isAnswered ? 'border-ring ring-1 ring-ring' : 'border-border text-muted-foreground'}`}>
            <span data-testid="bridge-done-radio" data-filled={isAnswered} aria-hidden="true" className={`mt-1 grid size-4 shrink-0 place-items-center rounded-full border ${isAnswered ? 'border-primary' : 'border-border'}`}>
              {isAnswered ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <span className="grid flex-1 gap-0.5">
              <span className="font-medium">
                {option.key}. {option.label}
              </span>
              {option.detail === '' ? null : <span className="text-caption text-muted-foreground max-md:hidden">{option.detail}</span>}
            </span>
            {option.key === question.pick.option ? <span className="rounded-sm border border-border px-1.5 text-caption">Their pick</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** What came of it, where and when, in the ok tone when it ended well and the ended tone otherwise, and what was sent as the person (decide.html, do.html). */
function EndedNotice({ ended }: { ended: NonNullable<ReturnType<typeof endedOf>> }) {
  const Icon = ended.isOk ? CircleCheck : CircleX;
  return (
    <div data-testid="bridge-done-ended" role="status" className={`flex items-start gap-3 rounded-md border p-3 ${ended.isOk ? 'border-tone-ok-border bg-tone-ok-bg' : 'border-tone-ended-border bg-tone-ended-bg'}`}>
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${ended.isOk ? 'text-tone-ok-fg' : 'text-tone-ended-fg'}`} />
      <span className="grid gap-0.5">
        <span className="font-medium">{ended.text}</span>
        {ended.sent === undefined ? null : <span className="text-caption text-muted-foreground">{ended.sent}</span>}
      </span>
    </div>
  );
}

/** Its history, a line per moment: when it arrived and where it showed, where it was seen, and what came of it (decide.html). */
function History({ item, timeZone }: { item: RecordItem; timeZone: string | undefined }) {
  return (
    <ol data-testid="bridge-done-history" className="grid gap-1.5 text-caption max-md:hidden">
      {historyOf(item, timeZone).map((line) => (
        <li key={`${line.at} ${line.text}`} className="grid grid-cols-[3rem_0.5rem_minmax(0,1fr)] items-center gap-2">
          <span className="text-muted-foreground tabular-nums">{line.at}</span>
          <i aria-hidden="true" className={`size-1.5 rounded-full ${line.isEnd ? 'bg-tone-ok-fg' : 'bg-border'}`} />
          <span>
            {line.text}
            {line.detail === undefined ? null : <span className="text-muted-foreground"> · {line.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A done item opened from Done (decide.html, answered in Slack): read back
 * whole from the record, nothing acknowledged and nothing to send. A
 * question shows its options with the one answered marked, a step why and
 * where it was done, anything else what it says; then what came of it and
 * its history. A phone shows it on its own screen, titled by what came of
 * it, without its history, as drawn.
 */
export function DoneCard({ item, timeZone, bridgeHost, onBack }: { item: RecordItem; timeZone: string | undefined; bridgeHost: string; onBack: () => void }) {
  const question = questionOf(item);
  const step = stepOf(item, bridgeHost);
  const ended = endedOf(item, timeZone);
  const opened = { job: item.job, isAlert: item.isAlert, wasNew: false };
  return (
    <section data-testid="bridge-done-item" className="grid min-w-0 content-start gap-3 text-card-foreground md:p-5">
      <ScreenBar opened={opened} title={endedTitleOf(item)} isWorking={false} onBack={onBack} />
      <ItemHeading delivery={item} opened={opened} timeZone={timeZone} />
      <h2 className="text-heading font-semibold">{question?.title ?? item.title}</h2>
      {step !== undefined ? (
        <StepAsked step={step} isStale={false} isFinished />
      ) : question === undefined ? (
        <Markdown text={bodyOf(item)} />
      ) : (
        <>
          <div className={PROSE}>
            <Markdown text={question.context} />
          </div>
          <AnsweredOptions question={question} answered={item.outcome?.option ?? null} />
        </>
      )}
      {ended === undefined ? null : <EndedNotice ended={ended} />}
      <History item={item} timeZone={timeZone} />
    </section>
  );
}
