import { describe, expect, it } from 'vitest';

import type { BridgeScreen } from '../../../web/features/bridge/services/shell';
import { sendsFromPhoneTopBar } from './phone-send';

// The phone sends a ship a message from its top bar (the #1560 sheet): on
// home, and on Messages as home does (#284).

describe("the phone's top bar, sending a ship a message (#284)", () => {
  it('offers it on home and on Messages', () => {
    expect([sendsFromPhoneTopBar('home'), sendsFromPhoneTopBar('messages')]).toEqual([true, true]);
  });

  it('offers it on no other page', () => {
    const others: readonly BridgeScreen[] = ['basket', 'stay-aware', 'done', 'fleet', 'routing', 'outside-parties', 'settings'];

    expect(others.filter(sendsFromPhoneTopBar)).toEqual([]);
  });
});
