import { isIP } from 'node:net';

import type { HostResolver } from './ports.js';
import { isPublicAddress } from './webhook.js';

/**
 * Where the webhook's host is reached now: an address as the host is itself,
 * a name at every address it resolves to. It is public only when every one
 * is; inside when any is not; unresolved when a name resolves to nothing.
 */
export async function reachOf(resolver: HostResolver, url: URL): Promise<'public' | 'inside' | 'unresolved'> {
  // An IPv6 host is written in brackets in a URL.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const addresses = isIP(host) === 0 ? await resolver.addressesOf(host) : [host];
  if (addresses.length === 0) {
    return 'unresolved';
  }
  return addresses.every(isPublicAddress) ? 'public' : 'inside';
}
