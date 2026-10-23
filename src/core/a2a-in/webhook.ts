/**
 * An outside A2A client's webhook (slice 4): where the gateway POSTs each
 * change of its task. The gateway calls it from inside the fleet's network
 * at a URL the outside chose, so it is an https URL that carries no
 * credentials, reached only at a public address: never loopback, private,
 * shared, link-local (cloud metadata), unique-local, site-local,
 * documentation, multicast or reserved, nor an IPv6 address that carries an
 * IPv4 one inside (IPv4-mapped, IPv4-compatible, NAT64, 6to4, Teredo).
 * The address is checked once the host resolves, when the config is set and
 * again at each push, so a name that resolves to an inside address is
 * refused like the address itself.
 */
import { BlockList, isIP } from 'node:net';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** The addresses no webhook is reached at. */
const INSIDE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  INSIDE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  // IPv4-compatible (::a.b.c.d), unspecified and loopback.
  ['::', 96],
  // NAT64, Teredo and 6to4 carry an IPv4 address inside, which could be any inside one: refused whole, as ::ffff: is.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2001::', 32],
  ['2002::', 16],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  INSIDE.addSubnet(network, prefix, 'ipv6');
}

const IPV4 = 4;

/** Whether a webhook may be reached at this address: a public unicast one. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) {
    return false;
  }
  // An IPv4 address written as IPv6 (::ffff:a.b.c.d) is refused whole: a webhook never needs one, and it could name any inside address.
  if (version !== IPV4 && /^::ffff:/i.test(address)) {
    return false;
  }
  return !INSIDE.check(address, version === IPV4 ? 'ipv4' : 'ipv6');
}

/** A webhook's URL: https, with a host and no credentials in it. */
export function webhookUrlOf(raw: string): Result<URL, DomainError<'WEBHOOK_REFUSED'>> {
  if (!URL.canParse(raw)) {
    return refuse('WEBHOOK_REFUSED', 'The webhook is no URL: name an https URL');
  }
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname === '') {
    return refuse('WEBHOOK_REFUSED', 'The webhook must be an https URL');
  }
  if (url.username !== '' || url.password !== '') {
    return refuse('WEBHOOK_REFUSED', 'The webhook URL carries credentials: send them as the config\'s authentication');
  }
  return ok(url);
}
