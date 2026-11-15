import type { BridgeScreen } from '../../../web/features/bridge/services/shell';

/** The pages whose phone top bar sends a ship a message (the #1560 sheet): home, and Messages as home does (#284). */
const SENDING_SCREENS: ReadonlySet<BridgeScreen> = new Set<BridgeScreen>(['home', 'messages']);

/** Whether a page's phone top bar offers to send a ship a message, while no item is open in place of its list. */
export function sendsFromPhoneTopBar(screen: BridgeScreen): boolean {
  return SENDING_SCREENS.has(screen);
}
