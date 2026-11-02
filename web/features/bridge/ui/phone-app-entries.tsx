import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import type { AvatarMenuEntry } from '@aeolus-fleet/ui';
import { AppWindow, Check } from 'lucide-react';

/** The shared switcher's permitted apps, offered in the phone avatar sheet without replacing the screen title. */
export function phoneAppEntries(switcher: AppSwitcherModel | undefined): AvatarMenuEntry[] {
  return switcher?.apps.map(({ app, label, url, isCurrent }) => ({
    key: `app-${app}`,
    label,
    href: url,
    icon: isCurrent ? <Check aria-hidden /> : <AppWindow aria-hidden />,
    isPhoneOnly: true,
  })) ?? [];
}
