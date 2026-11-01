import { Bell, CircleQuestionMark, Hand, Hash, Mail, MessageCircleQuestionMark, Ship, Sparkle, type LucideIcon } from 'lucide-react';

import type { RoutedJob, RoutedPlace } from '../services/routing';

/** Each job's icon in its tone, as the routing mockup draws it: Decide active, Do waiting, the others muted. */
export const JOB_ICONS: Readonly<Record<RoutedJob, { readonly Icon: LucideIcon; readonly tone: string }>> = {
  decide: { Icon: CircleQuestionMark, tone: 'text-tone-active-fg' },
  do: { Icon: Hand, tone: 'text-tone-waiting-fg' },
  'stay-aware': { Icon: Bell, tone: 'text-muted-foreground' },
  'everything-else': { Icon: MessageCircleQuestionMark, tone: 'text-muted-foreground' },
};

/** Bridge's icon, the mark of the sidebar. */
export const BRIDGE_ICON: LucideIcon = Ship;

/** Each place's icon, as the routing mockup draws it. */
export const PLACE_ICONS: Readonly<Record<RoutedPlace, LucideIcon>> = { slack: Hash, chat: Sparkle, 'web-push': Bell, email: Mail };
