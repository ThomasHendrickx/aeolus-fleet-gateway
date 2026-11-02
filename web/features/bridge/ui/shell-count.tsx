import { classNames } from '@aeolus-fleet/ui';

/** How a count is drawn in the shell: waiting in its tone, the basket filled, alerts in theirs, anything else plain. */
export type CountTone = 'waiting' | 'basket' | 'attention' | 'plain';

const TONES: Record<CountTone, string> = {
  waiting: 'bg-tone-waiting-bg text-tone-waiting-fg',
  basket: 'bg-primary text-primary-foreground',
  attention: 'bg-tone-attention-bg text-tone-attention-fg',
  plain: 'bg-secondary text-foreground',
};

/** A count beside an entry of the shell (home.html): none at nought, nor while it is not known. */
export function ShellCount({ count, tone, className }: { count: number | undefined; tone: CountTone; className?: string }) {
  if (count === undefined || count === 0) {
    return null;
  }
  return <span className={classNames('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-micro font-semibold tabular-nums', TONES[tone], className)}>{count}</span>;
}
