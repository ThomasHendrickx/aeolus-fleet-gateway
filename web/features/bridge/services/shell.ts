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
  /** Whether the phone's title leads back to home with a back chevron. */
  readonly hasBack: boolean;
  /** The phone's tab shown current; none for a page under no tab, such as the settings. */
  readonly tab: PhoneTab | null;
}

const SCREENS: Record<BridgeScreen, ScreenNaming> = {
  home: { name: 'Bridge', hasBack: false, tab: 'waiting' },
  basket: { name: 'Basket', hasBack: true, tab: 'waiting' },
  'stay-aware': { name: 'Stay aware', hasBack: false, tab: 'aware' },
  done: { name: 'Done', hasBack: false, tab: 'done' },
  fleet: { name: 'Your fleet', hasBack: false, tab: 'fleet' },
  routing: { name: 'Where things show', hasBack: true, tab: null },
  settings: { name: 'Settings', hasBack: true, tab: null },
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
