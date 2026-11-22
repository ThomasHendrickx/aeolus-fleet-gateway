import { retry, handleAll } from 'cockatiel';
import { request } from './network.js';
// Existing real retry implementation at the SDK boundary: three total attempts.
export function makeSDK(network) {
 const policy=retry(handleAll, {maxAttempts:2});
 return {lookup: sku => policy.execute(()=>request(network,{operation:'lookup',payload:{sku},timeout:100})),
 charge: order => request(network,{operation:'charge',payload:order,timeout:100})};
}
