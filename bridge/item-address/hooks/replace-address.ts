/** The browser's history, as far as Bridge writes the open item's address into it. */
export type AddressHistory = Pick<History, 'state' | 'replaceState'>;

/** Puts the address in place of the current one, with no new history entry and no page read. */
export function replaceAddress(history: AddressHistory, address: string): void {
  history.replaceState(history.state, '', address);
}
