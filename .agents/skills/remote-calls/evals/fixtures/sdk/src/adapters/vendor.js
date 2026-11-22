import { retry, handleAll } from 'cockatiel';
import { makeSDK } from '../infra/sdk.js';
export function makeVendor(network, {dependency='payment'}={}) {
 const sdk=makeSDK(network); const outer=retry(handleAll,{maxAttempts:1});
 return {lookup:sku=>outer.execute(()=>sdk.lookup(sku)),charge:order=>sdk.charge(order)};
}
