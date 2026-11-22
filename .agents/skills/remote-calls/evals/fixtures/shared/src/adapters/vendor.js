import { request } from '../infra/network.js';
export function makeVendor(network, { dependency = 'payment' } = {}) {
  return {
    lookup: (sku) => request(network, { operation: 'lookup', payload: { sku } }),
    charge: (order) => request(network, { operation: 'charge', payload: order }),
  };
}
