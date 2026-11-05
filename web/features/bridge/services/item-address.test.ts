import { describe, expect, it } from 'vitest';

import { addressWithItem, itemOfAddress, type KnownItem } from './item-address';

const QUESTION: KnownItem = { deliveryId: 'dlv_01', job: 'decide', isAlert: false, state: 'new', inBasket: null };
const ALERT: KnownItem = { deliveryId: 'dlv_02', job: 'stay-aware', isAlert: true, state: 'seen', inBasket: null };

// A refresh reopens the item (aeolus-fleet-gateway#241).
describe('the item open in the address', () => {
  it('names the open item in the address, and the address opened anew finds that item again', () => {
    const address = addressWithItem('https://gw.example/bridge?fleet=flt_01', QUESTION.deliveryId);

    expect({ address, refreshed: itemOfAddress(address, [ALERT, QUESTION]) }).toEqual({
      address: 'https://gw.example/bridge?fleet=flt_01&item=dlv_01',
      refreshed: { kind: 'open', item: QUESTION },
    });
  });

  it('takes the item out of the address once none is open, keeping the rest of it', () => {
    expect(addressWithItem('https://gw.example/bridge?item=dlv_01&fleet=flt_01', undefined)).toBe('https://gw.example/bridge?fleet=flt_01');
  });

  it('shows the overview with a note for an item that is no longer in the inbox', () => {
    expect(itemOfAddress('https://gw.example/bridge?item=dlv_99', [QUESTION])).toEqual({ kind: 'gone' });
  });

  it('opens nothing for an address that names no item', () => {
    expect(itemOfAddress('https://gw.example/bridge', [QUESTION])).toEqual({ kind: 'none' });
  });
});
