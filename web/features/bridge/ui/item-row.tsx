import { Bell, CircleQuestionMark, Hand, Hash, Mail, Megaphone, MessageSquare, Ship, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Stale } from '../services/deliveries';
import { ageOf, jobWordOf, type HomeItem } from '../services/items';
import { Notice } from './notice';
import { StaleIcon } from './stale-icon';

type Job = HomeItem['job'];
type Place = HomeItem['places'][number];

/** Each job's icon and tone on a row (Bridge mockups, home): Decide blue, Do amber, Alert red, a notice and a message muted. */
const JOB_LOOKS: Record<Job | 'alert', { readonly icon: LucideIcon; readonly tone: string }> = {
  decide: { icon: CircleQuestionMark, tone: 'text-tone-active-fg' },
  do: { icon: Hand, tone: 'text-tone-waiting-fg' },
  alert: { icon: TriangleAlert, tone: 'text-tone-attention-fg' },
  'stay-aware': { icon: Megaphone, tone: 'text-muted-foreground' },
  'everything-else': { icon: MessageSquare, tone: 'text-muted-foreground' },
};

/** The places as a row draws them, Bridge first, as Where things show names them. */
const PLACES: Record<Place | 'bridge', { readonly icon: LucideIcon; readonly name: string }> = {
  bridge: { icon: Ship, name: 'Bridge' },
  slack: { icon: Hash, name: 'Slack' },
  chat: { icon: Sparkles, name: 'a chat' },
  'web-push': { icon: Bell, name: 'web push' },
  email: { icon: Mail, name: 'email' },
};

/** The names in a sentence: "Bridge", "Bridge and a chat", "Bridge, Slack and a chat". */
function listOf(names: readonly string[]): string {
  const last = names.at(-1) ?? '';
  return names.length < 2 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
}

/** When an item was sent, in UTC, to the minute: what its age stands for. */
function sentAtOf(sentAt: string): string {
  return `${new Date(sentAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-border">
      ·
    </span>
  );
}

/** The places that show an item as icons, Bridge always first, named whole for a screen reader. */
function Places({ places }: { places: readonly Place[] }) {
  const shown = (['bridge', ...places] as const).map((place) => PLACES[place]);
  return (
    <span role="img" aria-label={`Shows in ${listOf(shown.map(({ name }) => name))}`} className="inline-flex items-center gap-0.5">
      {shown.map(({ icon: Icon, name }) => (
        <Icon key={name} aria-hidden="true" className="size-3" />
      ))}
    </span>
  );
}

/**
 * One item in a Bridge list (Bridge mockups, home; aeolus-fleet#1535): its
 * job's icon, a dot while new, its title, then the job's word in its tone,
 * who sent it, its state, and the places that show it; how long ago it
 * arrived on the right; and its actions beneath, the one that acts in place
 * beside Open. Pressing the title opens it too. Struck through, on muted
 * ground and marked, when stale (basket.html). The row
 * and its title shrink to a phone's width (aeolus-fleet#1238).
 */
export function ItemRow({
  item,
  now,
  isNew,
  staleKind,
  outcome,
  failure,
  onOpen,
  actions,
}: {
  item: Pick<HomeItem, 'deliveryId' | 'from' | 'title' | 'sentAt' | 'job'> & { readonly isAlert?: boolean; readonly places?: readonly Place[] };
  /** When the page read its items: the age is from it. */
  now: Date;
  isNew: boolean;
  /** How its asker made it stale, withdrawn or replaced, outside the count; none while it stands. */
  staleKind?: Stale['kind'];
  /** What the row says of where the item stands, such as Seen or In the basket: option 2; nothing while new. */
  outcome: string | undefined;
  failure: string | undefined;
  /** Opens the item; none while it cannot be opened now. */
  onOpen?: () => void;
  actions?: ReactNode;
}) {
  const isAlert = item.isAlert ?? false;
  const look = JOB_LOOKS[isAlert ? 'alert' : item.job];
  const JobIcon = look.icon;
  const titleClass = 'min-w-0 truncate text-left font-medium';
  const title = staleKind === undefined ? item.title : <s className="decoration-muted-foreground">{item.title}</s>;
  return (
    <li data-testid="bridge-item" data-stale={staleKind !== undefined} className={`grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1.5 border-t border-border px-3 py-2.5 first:border-t-0 ${staleKind === undefined ? '' : 'bg-muted'}`}>
      <JobIcon aria-hidden="true" className={`mt-0.5 size-4 ${look.tone}`} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center">
          {isNew ? <span aria-label="New" className="mr-1.5 size-[7px] shrink-0 rounded-full bg-primary" /> : null}
          {onOpen === undefined ? (
            <span data-testid="bridge-item-title" className={titleClass}>
              {title}
            </span>
          ) : (
            <button type="button" data-testid="bridge-item-title" onClick={onOpen} className={`${titleClass} hover:underline`}>
              {title}
            </button>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
          <span className={`font-medium ${look.tone}`}>{jobWordOf({ job: item.job, isAlert })}</span>
          <Separator />
          <span>{item.from}</span>
          {outcome === undefined ? null : (
            <>
              <Separator />
              <span data-testid="bridge-outcome" className="inline-flex items-center gap-1.5">
                {staleKind === undefined ? null : <StaleIcon kind={staleKind} />}
                {outcome}
              </span>
            </>
          )}
          {item.places === undefined ? null : (
            <>
              <Separator />
              <Places places={item.places} />
            </>
          )}
        </span>
      </span>
      <time dateTime={item.sentAt} title={sentAtOf(item.sentAt)} className="whitespace-nowrap text-right text-caption text-muted-foreground">
        {ageOf(item.sentAt, now)}
      </time>
      {actions === undefined || actions === null ? null : <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-1.5">{actions}</div>}
      {failure === undefined ? null : (
        <div className="col-span-2 col-start-2">
          <Notice message={failure} isFailure />
        </div>
      )}
    </li>
  );
}
