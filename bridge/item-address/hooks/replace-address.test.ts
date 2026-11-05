import { describe, expect, it } from 'vitest';

import { replaceAddress, type AddressHistory } from './replace-address';

/**
 * The browser's history as Next.js 16's app router patches it: a write whose
 * state carries the router's own mark (__NA) is taken as the router's and
 * left unread; any other write becomes the router's address. Each page
 * re-read (router.refresh, the live stream's read again) writes the router's
 * address back into the browser.
 */
function aRouterHistory(address: string): AddressHistory & { readonly address: string; readAgain: () => void } {
  let browserAddress = address;
  let routerAddress = address;
  let state: unknown = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['', {}] };
  const isRouters = (data: unknown): boolean => typeof data === 'object' && data !== null && '__NA' in data;
  return {
    get state() {
      return state;
    },
    get address() {
      return browserAddress;
    },
    // History's own signature, as a list: its unused second place stays unnamed.
    replaceState(...[data, , url]: Parameters<History['replaceState']>) {
      if (url === undefined || url === null) {
        return;
      }
      if (!isRouters(data)) {
        routerAddress = String(url);
      }
      state = isRouters(data) ? data : { ...(typeof data === 'object' ? data : {}), __NA: true };
      browserAddress = String(url);
    },
    readAgain() {
      browserAddress = routerAddress;
    },
  };
}

// The open item stays in the address (aeolus-fleet-gateway#282, #241).
describe("the open item's address", () => {
  it('keeps the open item in the address through a page re-read', () => {
    const history = aRouterHistory('https://gw.example/bridge?fleet=flt_01');

    replaceAddress(history, 'https://gw.example/bridge?fleet=flt_01&item=dlv_01');
    history.readAgain();

    expect(history.address).toBe('https://gw.example/bridge?fleet=flt_01&item=dlv_01');
  });

  it('keeps the address without an item through a page re-read once none is open', () => {
    const history = aRouterHistory('https://gw.example/bridge?fleet=flt_01&item=dlv_01');

    replaceAddress(history, 'https://gw.example/bridge?fleet=flt_01');
    history.readAgain();

    expect(history.address).toBe('https://gw.example/bridge?fleet=flt_01');
  });
});
