import { AppSwitcher, type AppSwitcherModel } from '@aeolus-fleet/common/header';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { inFleet } from '../../../lib/gateway-api/page-account';
import { BRIDGE_PATH } from '../paths';
import { screenOf, type BridgeScreen } from '../services/shell';

/** What the breadcrumb names while an item is open from home: the list it was opened from (decide.html, do.html, basket.html). */
const OPENED_FROM_HOME = 'Waiting on you';

/** An item open in place of its list: the phone's title names it, and its back chevron closes it. */
export interface OpenedItem {
  readonly title: string;
  readonly onBack: () => void;
}

const BACK = 'inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent sm:hidden';

function Back({ fleetId, hasBack, opened }: { fleetId: string; hasBack: boolean; opened: OpenedItem | undefined }) {
  if (opened !== undefined) {
    return (
      <button type="button" data-testid="bridge-back" aria-label="Back" onClick={opened.onBack} className={BACK}>
        <ChevronLeft aria-hidden className="size-5" />
      </button>
    );
  }
  if (!hasBack) {
    return null;
  }
  return (
    <a data-testid="bridge-back" aria-label="Back to Bridge" href={inFleet(BRIDGE_PATH, fleetId)} className={BACK}>
      <ChevronLeft aria-hidden className="size-5" />
    </a>
  );
}

/**
 * Bridge's top bar: the shared app switcher replaces the mockups' product
 * name, full on desktop and compact on phone. A subpage keeps its name
 * beside it, with the phone's back chevron and opened item's title.
 * Before the account can be read, the plain breadcrumb and title remain.
 */
export function BridgeTopBar({ fleetId, fleetName, screen, isLive, opened, avatar, switcher }: { fleetId: string; fleetName: string | undefined; screen: BridgeScreen; isLive: boolean; opened: OpenedItem | undefined; avatar: ReactNode; switcher?: AppSwitcherModel }) {
  const { name, hasBack } = screenOf(screen);
  const crumb = opened !== undefined && screen === 'home' ? OPENED_FROM_HOME : name;
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background pr-3 pl-4">
      <Back fleetId={fleetId} hasBack={hasBack} opened={opened} />
      {switcher === undefined ? (
        <>
          <span data-testid="bridge-crumb" className="text-muted-foreground max-sm:hidden">
            {fleetName === undefined ? null : `${fleetName} / `}
            <b className="font-semibold text-foreground">{crumb}</b>
          </span>
          <span data-testid="bridge-title" className={`min-w-0 flex-1 truncate font-semibold tracking-tight sm:hidden ${hasBack || opened !== undefined ? 'text-lg' : 'text-title-touch'}`}>
            {opened?.title ?? name}
          </span>
        </>
      ) : (
        <>
          <AppSwitcher switcher={switcher} layout="full" className="max-sm:hidden" />
          <AppSwitcher switcher={switcher} layout="compact" className="min-w-0 flex-1 sm:hidden" />
          {screen === 'home' && opened === undefined ? null : (
            <span data-testid="bridge-page" className="min-w-0 truncate text-muted-foreground">
              <span className="max-sm:hidden">/ {crumb}</span>
              <span className="sm:hidden">{opened?.title ?? name}</span>
            </span>
          )}
        </>
      )}
      {isLive ? (
        <span data-testid="bridge-live" className="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
          <i aria-hidden className="inline-block size-2 rounded-full bg-tone-ok-fg" />
          Live
        </span>
      ) : null}
      <span className="sm:hidden">{avatar}</span>
    </header>
  );
}
