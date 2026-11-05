/** The browser's history, as far as Bridge writes the open item's address into it. */
export type AddressHistory = Pick<History, 'replaceState'>;

/**
 * Puts the address in place of the current one, with no new history entry and
 * no page read. It writes no state of its own: Next.js's router takes a write
 * carrying its own state as its own and keeps its old address, which its next
 * page re-read would write back (#282).
 */
export function replaceAddress(history: AddressHistory, address: string): void {
  history.replaceState(null, '', address);
}
