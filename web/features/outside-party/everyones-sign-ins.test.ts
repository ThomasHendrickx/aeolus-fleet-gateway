import { describe, expect, it } from 'vitest';

import { removedMessageOf, withNextPage } from './everyones-sign-ins';

// Everyone's sign-ins on a server's page, for approvers (decision 0067, M3).

describe('how a removal of a person’s sign-in is said', () => {
  it('says it is removed and revoked where the server revoked it', () => {
    expect(removedMessageOf({ person: 'joris', party: 'attio', isRevoked: true })).toBe("joris's sign-in is removed, and revoked at attio.");
  });

  it('says it is removed alone where the server offers no revocation or did not answer', () => {
    expect(removedMessageOf({ person: 'joris', party: 'attio', isRevoked: false })).toBe("joris's sign-in is removed.");
  });
});

describe('a next page of sign-ins, as Show more adds it', () => {
  it('adds the next page after the rows shown', () => {
    expect(withNextPage([{ personShipId: 'shp_a' }], [{ personShipId: 'shp_b' }])).toEqual([{ personShipId: 'shp_a' }, { personShipId: 'shp_b' }]);
  });

  it('shows a person already shown once, as a removal moves the pages along', () => {
    expect(withNextPage([{ personShipId: 'shp_a' }, { personShipId: 'shp_b' }], [{ personShipId: 'shp_b' }, { personShipId: 'shp_c' }])).toEqual([{ personShipId: 'shp_a' }, { personShipId: 'shp_b' }, { personShipId: 'shp_c' }]);
  });
});
