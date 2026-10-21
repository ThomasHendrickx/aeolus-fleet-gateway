import type { Status, Tone } from '../services/requests';

const TONES: Record<Tone, string> = {
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  active: 'border-tone-active-border bg-tone-active-bg text-tone-active-fg',
  ok: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg',
  attention: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  ended: 'border-tone-ended-border bg-tone-ended-bg text-tone-ended-fg',
};

/** A status in its tone, always with its words, so it never rests on colour alone. */
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-caption ${TONES[status.tone]}`}>{status.label}</span>;
}
