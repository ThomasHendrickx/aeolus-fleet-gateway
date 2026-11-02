/**
 * Bridge's shell (docs/design/bridge/mockups): the screen in view named as
 * the sidebar names it, in the breadcrumb on desktop and as the phone's
 * screen title, with a back chevron where it leads back to home, and the
 * phone's tab it is under. Pure view logic, no React and no API client.
 */
import type { HomeItem } from './items';

/** Bridge's pages, each a screen of the shell. */
export type BridgeScreen = 'home' | 'basket' | 'stay-aware' | 'done' | 'fleet' | 'routing' | 'settings';

/** The phone's four tabs. */
export type PhoneTab = 'waiting' | 'aware' | 'done' | 'fleet';

export interface ScreenNaming {
  readonly name: string;
  /** The phone's title, the tab's own word where the tab bar names it shorter (Fleet). */
  readonly phoneTitle: string;
  /** Whether the phone's title leads back to home with a back chevron. */
  readonly hasBack: boolean;
  /** The phone's tab shown current; none for a page under no tab, such as the settings. */
  readonly tab: PhoneTab | null;
}

const SCREENS: Record<BridgeScreen, ScreenNaming> = {
  home: { name: 'Bridge', phoneTitle: 'Bridge', hasBack: false, tab: 'waiting' },
  basket: { name: 'Basket', phoneTitle: 'Basket', hasBack: true, tab: 'waiting' },
  'stay-aware': { name: 'Stay aware', phoneTitle: 'Stay aware', hasBack: false, tab: 'aware' },
  done: { name: 'Done', phoneTitle: 'Done', hasBack: false, tab: 'done' },
  fleet: { name: 'Your fleet', phoneTitle: 'Fleet', hasBack: false, tab: 'fleet' },
  routing: { name: 'Where things show', phoneTitle: 'Where things show', hasBack: true, tab: null },
  settings: { name: 'Settings', phoneTitle: 'Settings', hasBack: true, tab: null },
};

const OPENED: Record<HomeItem['job'], string> = {
  decide: 'Question',
  do: 'Step',
  'stay-aware': 'Stay aware',
  'everything-else': 'Message',
};

export function screenOf(screen: BridgeScreen): ScreenNaming {
  return SCREENS[screen];
}

/** The phone's title while an item is open in place of its list, by its job. */
export function openedScreenOf(job: HomeItem['job']): string {
  return OPENED[job];
}

/** The counts the shell shows: what waits, the unseen to stay aware of, the basket's answers and the ships with an alert; one not known now is left out. */
export interface ShellCounts {
  readonly waiting: number | undefined;
  readonly stayAware: number | undefined;
  readonly basket: number;
  readonly fleetAlerts: number | undefined;
  /** What waits at argo, apart from what waits on the person (argo's inbox, AI4); none for an account not allowed as argo. */
  readonly argo?: number;
}

/** Bridge home as the shell reads it: its counts, none for an account with no person ship, or not readable now. */
export type HomeForCounts =
  | { readonly kind: 'read'; readonly value: { readonly waiting: { readonly count: number }; readonly stayAware: readonly { readonly state: string }[] } }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' };

/** What waits as home counts it; of the stay-aware feed only the alerts and notices not seen yet (CC16); what waits at argo in a count of its own. */
export function shellCountsOf({ home, basket, fleetAlerts, argo }: { home: HomeForCounts; basket: number; fleetAlerts: number | undefined; argo?: number | undefined }): ShellCounts {
  const others = { basket, fleetAlerts, ...(argo === undefined ? {} : { argo }) };
  switch (home.kind) {
    case 'read':
      return { waiting: home.value.waiting.count, stayAware: home.value.stayAware.filter(({ state }) => state === 'new').length, ...others };
    case 'none':
      return { waiting: 0, stayAware: 0, ...others };
    case 'unreadable':
      return { waiting: undefined, stayAware: undefined, ...others };
  }
}
