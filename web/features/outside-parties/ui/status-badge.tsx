import type { Tone } from '../party-kinds';

const TONES: Record<Tone, string> = {
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  active: 'border-tone-active-border bg-tone-active-bg text-tone-active-fg',
  ok: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-fg',
  attention: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
  ended: 'border-tone-ended-border bg-tone-ended-bg text-tone-ended-fg',
};

/** A status in the Compact look (design/bridge-navigation): its tone's word alone, unfilled; only an attention keeps its fill. */
const FLAT_TONES: Record<Tone, string> = {
  waiting: 'text-tone-waiting-fg',
  active: 'text-tone-active-fg',
  ok: 'text-tone-ok-fg',
  attention: 'rounded-sm border border-tone-attention-border bg-tone-attention-bg px-1.5 text-tone-attention-fg',
  ended: 'text-tone-ended-fg',
};

/** A pill, as the console shows a status; flat, as Bridge's pages draw one. */
export type BadgeLook = 'pill' | 'flat';

/** A status in its tone, with its icon where it has one, such as the check of On. */
export function StatusBadge({ tone, label, look = 'pill', icon }: { tone: Tone; label: string; look?: BadgeLook; icon?: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-caption ${look === 'pill' ? `rounded-full border px-2 ${TONES[tone]}` : `h-5.5 px-0.5 font-medium ${FLAT_TONES[tone]}`}`}>
      {icon}
      {label}
    </span>
  );
}

/** A plain tag: a protocol, a side, an id. */
export function Tag({ children, isMono = false }: { children: React.ReactNode; isMono?: boolean }) {
  return <span className={`inline-flex h-5.5 items-center rounded-sm border border-border px-1.5 text-caption font-medium ${isMono ? 'font-mono' : ''}`}>{children}</span>;
}
