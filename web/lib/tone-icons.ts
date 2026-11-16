import type { StatusTone } from '@aeolus-fleet/ui';
import { CircleAlert, CircleArrowRight, CircleCheck, CircleMinus, Hourglass, type LucideIcon } from 'lucide-react';

const TONE_ICONS: Record<StatusTone, LucideIcon> = {
  waiting: Hourglass,
  active: CircleArrowRight,
  ok: CircleCheck,
  attention: CircleAlert,
  ended: CircleMinus,
};

/** The icon a status shows for its tone, as the console's badges do, so a status never rests on colour alone. */
export function toneIcon(tone: StatusTone): LucideIcon {
  return TONE_ICONS[tone];
}
