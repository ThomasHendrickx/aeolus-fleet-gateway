'use client';

import { usePathname } from 'next/navigation';

import { inFleet } from '../../../lib/gateway-api/page-account';

/** The gateway's pages a person goes between. */
const TABS = [
  { key: 'overview', label: 'Overview', path: '/overview' },
  { key: 'outside-parties', label: 'Outside parties', path: '/outside-parties' },
  { key: 'parties', label: 'Parties', path: '/parties' },
] as const;

/** Whether the page at this path is the tab's page or one of its own. */
function isTabOf(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The header's tabs: the overview, the outside parties and the parties of the fleet in view, the page shown current. */
export function GatewayTabs({ fleetId }: { fleetId: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Gateway" className="flex shrink-0 items-center gap-1">
      {TABS.map(({ key, label, path }) => {
        const isCurrent = isTabOf(pathname, path);
        return (
          <a
            key={key}
            href={inFleet(path, fleetId)}
            data-testid={`frame-tab-${key}`}
            aria-current={isCurrent ? 'page' : undefined}
            className={`whitespace-nowrap rounded-md px-2 py-1 text-sm ${isCurrent ? 'bg-accent font-semibold' : 'text-muted-foreground hover:bg-accent'}`}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
