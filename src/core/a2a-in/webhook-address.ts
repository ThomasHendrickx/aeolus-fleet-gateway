import { isIP } from 'node:net';

import type { HostResolver } from './ports.js';
import { isPublicAddress } from './webhook.js';

/**
 * Whether the webhook's host is reached only at public addresses now: an
 * address as the host is itself, a name by every address it resolves to. A
 * name that resolves to nothing, or to any inside address, is not.
 */
export async function isReachedOnlyInPublic(resolver: HostResolver, url: URL): Promise<boolean> {
  // An IPv6 host is written in brackets in a URL.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const addresses = isIP(host) === 0 ? await resolver.addressesOf(host) : [host];
  return addresses.length > 0 && addresses.every(isPublicAddress);
}
