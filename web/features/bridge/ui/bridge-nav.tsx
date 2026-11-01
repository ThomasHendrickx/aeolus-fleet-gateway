import { inFleet } from '../../../lib/gateway-api/page-account';
import { BRIDGE_DONE_PATH, BRIDGE_PATH, BRIDGE_SETTINGS_PATH } from '../hooks/read-bridge';

const PAGES = [
  { key: 'home', label: 'Waiting on you', path: BRIDGE_PATH },
  { key: 'done', label: 'Done', path: BRIDGE_DONE_PATH },
  { key: 'settings', label: 'Settings', path: BRIDGE_SETTINGS_PATH },
] as const;

export type BridgePage = (typeof PAGES)[number]['key'];

/** Bridge's pages a person goes between: what waits on them, Done, and Bridge's settings; the page shown current. */
export function BridgeNav({ fleetId, current }: { fleetId: string; current: BridgePage }) {
  return (
    <nav aria-label="Bridge" className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border pb-2">
      {PAGES.map(({ key, label, path }) => (
        <a
          key={key}
          href={inFleet(path, fleetId)}
          data-testid={`bridge-nav-${key}`}
          aria-current={key === current ? 'page' : undefined}
          className={`whitespace-nowrap rounded-md px-2 py-1 text-sm ${key === current ? 'bg-accent font-semibold' : 'text-muted-foreground hover:bg-accent'}`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
