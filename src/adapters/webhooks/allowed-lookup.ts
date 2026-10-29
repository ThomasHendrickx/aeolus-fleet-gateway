/**
 * A lookup for an outgoing connection that answers only the addresses the
 * policy allows, as the name resolves at the moment of connecting, and
 * refuses the connection otherwise: a name that resolved elsewhere when it
 * was checked cannot steer the connection inside. Webhooks and web push use it.
 */
import type { LookupFunction } from 'node:net';

/** The code of the error a connection is refused with when its host resolves to an address the policy refuses. */
export const ADDRESS_REFUSED = 'ADDRESS_REFUSED';
const IPV4 = 4;
const IPV6 = 6;

/** A lookup that answers only the allowed addresses of the name, and refuses the connection otherwise. */
export function allowedLookup(deps: { addressesOf: (host: string) => Promise<string[]>; isAllowedAddress: (address: string) => boolean }): LookupFunction {
  // eslint-disable-next-line @typescript-eslint/max-params -- Node's net.LookupFunction takes these three.
  return (host, options, callback) => {
    deps.addressesOf(host).then(
      (addresses) => {
        const [address] = addresses;
        if (address === undefined || !addresses.every(deps.isAllowedAddress)) {
          callback(Object.assign(new Error(`${host} resolves to an address the gateway does not reach`), { code: ADDRESS_REFUSED }), '', IPV4);
          return;
        }
        const familyOf = (each: string) => (each.includes(':') ? IPV6 : IPV4);
        // Node asks for every address when it tries them in turn (autoSelectFamily).
        if (options.all === true) {
          callback(null, addresses.map((each) => ({ address: each, family: familyOf(each) })));
        } else {
          callback(null, address, familyOf(address));
        }
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), '', IPV4);
      },
    );
  };
}
