import { describe, expect, it } from 'vitest';

import { createCallKeys } from './call-keys.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MESSAGE = 'msg_01m3tbfspe96yf1rnr4ank9m01';

describe("the keys of an outside client's call, derived under the gateway secret (NAT both ways)", () => {
  it("derives the send's idempotency key from the fleet, the party and the client's key: the same for the same, another for any other", () => {
    const keys = createCallKeys(SECRET);
    const derived = [keys.idempotencyKeyOf({ fleetId: FLEET, party: 'claude', key: 'k-1' }), keys.idempotencyKeyOf({ fleetId: FLEET, party: 'claude', key: 'k-1' }), keys.idempotencyKeyOf({ fleetId: FLEET, party: 'cursor', key: 'k-1' }), keys.idempotencyKeyOf({ fleetId: OTHER_FLEET, party: 'claude', key: 'k-1' }), keys.idempotencyKeyOf({ fleetId: FLEET, party: 'claude', key: 'k-2' })];

    expect(new Set(derived).size).toBe(4);
    expect(derived[0]).not.toContain('k-1');
  });

  it('keeps the parts apart, so a party name with a colon makes no other key', () => {
    const keys = createCallKeys(SECRET);

    expect(keys.idempotencyKeyOf({ fleetId: FLEET, party: 'a:b', key: 'c' })).not.toBe(keys.idempotencyKeyOf({ fleetId: FLEET, party: 'a', key: 'b:c' }));
  });

  it("answers a handle that tells nothing of the message id, the same for the same message, another under another secret", () => {
    const keys = createCallKeys(SECRET);

    expect(keys.handleOf(FLEET, MESSAGE)).toBe(keys.handleOf(FLEET, MESSAGE));
    expect(keys.handleOf(FLEET, MESSAGE)).not.toContain('01m3tbfspe96yf1rnr4ank9m01');
    expect(createCallKeys('another-gateway-secret-of-32-characters!').handleOf(FLEET, MESSAGE)).not.toBe(keys.handleOf(FLEET, MESSAGE));
  });

  it('draws a new idempotency key each time', () => {
    const keys = createCallKeys(SECRET);

    expect(keys.newIdempotencyKey()).not.toBe(keys.newIdempotencyKey());
  });
});
