/**
 * The item open in Bridge, named in the address so a refresh opens it again
 * (aeolus-fleet-gateway#241): pure view logic, no React and no API client.
 */
import type { HomeItem } from './items';

/** The address parameter that names the open item, by its delivery. */
const ITEM_PARAMETER = 'item';

/** An item of a page's list that can be opened from the address: what opening it needs to know. */
/** An item the page lists, with how its asker made it stale where the list says so. */
export type KnownItem = Pick<HomeItem, 'deliveryId' | 'job' | 'isAlert' | 'state' | 'inBasket'> & { readonly stale?: HomeItem['stale'] };

/** What the address asks for: nothing, an item of the page's list to open, or an item no longer in the inbox. */
export type AddressedItem = { kind: 'none' } | { kind: 'open'; item: KnownItem } | { kind: 'gone' };

/** The address with the open item named in it, or without any item once none is open; the rest of the address stays. */
export function addressWithItem(address: string, deliveryId: string | undefined): string {
  const url = new URL(address);
  if (deliveryId === undefined) {
    url.searchParams.delete(ITEM_PARAMETER);
  } else {
    url.searchParams.set(ITEM_PARAMETER, deliveryId);
  }
  return url.toString();
}

/** The item the address names, found among the items the page lists. */
export function itemOfAddress(address: string, known: readonly KnownItem[]): AddressedItem {
  const deliveryId = new URL(address).searchParams.get(ITEM_PARAMETER);
  if (deliveryId === null) {
    return { kind: 'none' };
  }
  const item = known.find((candidate) => candidate.deliveryId === deliveryId);
  return item === undefined ? { kind: 'gone' } : { kind: 'open', item };
}
