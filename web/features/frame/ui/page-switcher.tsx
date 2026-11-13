'use client';

import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { AppSwitcher } from '@aeolus-fleet/ui';
import { usePathname } from 'next/navigation';

import { switcherOnPage } from '../services/header-switchers';

/** The switcher in the title on a page of the gateway: choosing another fleet keeps the page (H9). */
export function PageSwitcher({ switcher, className }: { switcher: AppSwitcherModel; className?: string }) {
  const pathname = usePathname();
  return <AppSwitcher switcher={switcherOnPage(switcher, pathname)} layout="full" className={className} />;
}
