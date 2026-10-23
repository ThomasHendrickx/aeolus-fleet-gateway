import { lookup } from 'node:dns/promises';

import type { HostResolver } from '../../core/a2a-in/ports.js';

/** The addresses a host resolves to, as the system resolves it: none when it does not. */
export const systemHostResolver: HostResolver = {
  addressesOf: async (host) => {
    try {
      return (await lookup(host, { all: true, verbatim: true })).map((found) => found.address);
    } catch {
      return [];
    }
  },
};
