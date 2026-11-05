import { Ban, ExternalLink, Replace, UserRound } from 'lucide-react';

import { ARGO_SECTION_ANCHOR, argoActionOf, doneLineOf, type ArgoSection } from '../services/argo-section';
import { ageOf } from '../services/items';
import { SIZES } from './action-button';
import { ArgoMark } from './argo-mark';
import { LEAVING } from './item-row';
import { JOB_LOOKS } from './job-looks';

type ArgoItem = ArgoSection['items'][number];

/** Each look as Bridge draws its jobs: a question as one to decide, a report as an alert, a notice muted. */
const LOOKS: Record<ArgoItem['look'], (typeof JOB_LOOKS)[keyof typeof JOB_LOOKS]> = {
  decide: JOB_LOOKS.decide,
  alert: JOB_LOOKS.alert,
  notice: JOB_LOOKS['stay-aware'],
};

function Separator() {
  return (
    <span aria-hidden="true" className="text-border">
      ·
    </span>
  );
}

/** One message waiting at argo: its look, a dot while new, its title, then For argo, its kind and its sender, its age, and its one button to act on it in the console as argo. */
function ArgoRow({ item, now, isLeaving }: { item: ArgoItem; now: Date; isLeaving: boolean }) {
  const look = LOOKS[item.look];
  const Icon = look.icon;
  const isStale = item.stale !== null;
  const StaleMark = item.stale?.kind === 'replaced' ? Replace : Ban;
  return (
    <li data-testid="bridge-argo-item" data-stale={isStale} data-leaving={isLeaving || undefined} className={`grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1.5 border-t border-border px-3 py-2.5 first:border-t-0 ${isStale ? 'bg-muted' : ''} ${isLeaving ? LEAVING : ''}`}>
      <Icon aria-hidden="true" className={`mt-0.5 size-4 ${look.tone}`} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline sm:items-center">
          {item.isNew ? (
            <span role="img" aria-label="New" className="mr-1.5 size-[7px] shrink-0 -translate-y-px rounded-full bg-primary">
              <span className="sr-only">New</span>
            </span>
          ) : null}
          <span className="min-w-0 break-words text-body-touch font-medium sm:truncate sm:text-body">{isStale ? <s className="decoration-muted-foreground">{item.title}</s> : item.title}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            <UserRound aria-hidden="true" className="size-3" />
            For argo
          </span>
          <Separator />
          <span className={`font-medium ${look.tone}`}>{item.kind === 'question' ? 'Question' : 'Report'}</span>
          <Separator />
          <span>{item.from}</span>
          {item.stale === null ? null : (
            <>
              <Separator />
              <span className="inline-flex items-center gap-1.5">
                <StaleMark aria-hidden="true" className="size-3.5 shrink-0" />
                {item.stale.kind === 'withdrawn' ? 'Withdrawn' : 'Replaced'}
              </span>
            </>
          )}
        </span>
      </span>
      <time dateTime={item.sentAt} className="whitespace-nowrap text-right text-caption text-muted-foreground">
        {ageOf(item.sentAt, now)}
      </time>
      <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-1.5">
        <a href={item.consoleUrl} data-testid="bridge-argo-act" className={`inline-flex items-center rounded-md border border-border bg-card text-card-foreground hover:bg-accent ${SIZES.row}`}>
          <ExternalLink aria-hidden="true" className="size-3.5" />
          {argoActionOf(item)}
        </a>
      </div>
    </li>
  );
}

/**
 * Bridge's argo section (argo-inbox mockups, bridge.html, after): below
 * what waits on the person and outside its count, what waits at argo with
 * argo's own count, each item marked For argo; the newest done at argo,
 * by whom and where; and what acting does to the sign-in as argo (AI2,
 * AI4). Only an account allowed as argo is given it.
 */
export function ArgoSectionList({ section, now, leaving = new Set() }: { section: ArgoSection; now: string; /** The stale rows leaving now, in their last 300 ms (#240). */ leaving?: ReadonlySet<string> }) {
  const readAt = new Date(now);
  return (
    <section id={ARGO_SECTION_ANCHOR} data-testid="bridge-argo" aria-labelledby="bridge-argo-heading" className="grid scroll-mt-4 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ArgoMark />
        <h2 id="bridge-argo-heading" className="text-section font-semibold">
          Waits at argo <span data-testid="bridge-argo-count" className="text-primary">{section.count}</span>
        </h2>
        <span className="text-caption text-muted-foreground max-sm:hidden sm:ml-auto">Not yours: argo&apos;s, for everyone allowed as argo. Outside your count.</span>
        <span className="basis-full text-caption text-muted-foreground sm:hidden">argo&apos;s, not yours; outside your count.</span>
      </div>
      {section.done === null ? null : (
        <p data-testid="bridge-argo-done" className="text-caption text-muted-foreground">
          <span className="max-sm:hidden">{doneLineOf(section.done, { isPhone: false })}</span>
          <span className="sm:hidden">{doneLineOf(section.done, { isPhone: true })}</span>
        </p>
      )}
      {section.items.length === 0 ? (
        <p className="rounded-md border border-border bg-card p-3 text-muted-foreground">Nothing waits at argo.</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-primary bg-card shadow-[inset_3px_0_0_var(--primary)]">
          {section.items.map((item) => (
            <ArgoRow key={item.deliveryId} item={item} now={readAt} isLeaving={leaving.has(item.deliveryId)} />
          ))}
        </ul>
      )}
      <p className="text-caption text-muted-foreground">Acting signs you in to the console as argo; it ends anyone else&apos;s sign-in as argo.</p>
    </section>
  );
}
