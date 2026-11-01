import { CircleQuestionMark, Hand, Megaphone, MessageSquare, TriangleAlert, type LucideIcon } from 'lucide-react';

import type { HomeItem } from '../services/items';

type Job = HomeItem['job'];

/** Each job's icon and tone, on a row and an opened item's heading (Bridge mockups): Decide blue, Do amber, Alert red, a notice and a message muted. */
export const JOB_LOOKS: Record<Job | 'alert', { readonly icon: LucideIcon; readonly tone: string }> = {
  decide: { icon: CircleQuestionMark, tone: 'text-tone-active-fg' },
  do: { icon: Hand, tone: 'text-tone-waiting-fg' },
  alert: { icon: TriangleAlert, tone: 'text-tone-attention-fg' },
  'stay-aware': { icon: Megaphone, tone: 'text-muted-foreground' },
  'everything-else': { icon: MessageSquare, tone: 'text-muted-foreground' },
};

/** The look of an item's job: an alert's own, otherwise its job's. */
export function jobLookOf({ job, isAlert }: { job: Job; isAlert: boolean }): (typeof JOB_LOOKS)[Job] {
  return JOB_LOOKS[isAlert ? 'alert' : job];
}
