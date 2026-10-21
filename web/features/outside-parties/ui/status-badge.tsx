import type { Tone } from '../party-kinds';

const TONES: Record<Tone, string> = {
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  active: 'border-tone-active-border bg-tone-active-bg text-tone-active-fg',
  ok: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg',
  attention: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  ended: 'border-tone-ended-border bg-tone-ended-bg text-tone-ended-fg',
};

/** A status in its tone, as the console shows one. */
export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 text-caption ${TONES[tone]}`}>{label}</span>;
}

/** A plain tag: a protocol, a side, an id. */
export function Tag({ children, isMono = false }: { children: React.ReactNode; isMono?: boolean }) {
  return <span className={`inline-flex items-center rounded-md border border-border px-2 text-caption ${isMono ? 'font-mono' : ''}`}>{children}</span>;
}
