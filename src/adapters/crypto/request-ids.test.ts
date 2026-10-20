import { describe, expect, it } from 'vitest';

import { createRequestIds } from './request-ids.js';

describe('pending request ids', () => {
  it('are prefixed req_ with a lowercase ULID body', () => {
    expect(createRequestIds().newRequestId()).toMatch(/^req_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
  });

  it('sort in the order they were made, within one millisecond too', () => {
    const ids = createRequestIds({ now: () => 1_760_950_800_000 });
    const made = [ids.newRequestId(), ids.newRequestId(), ids.newRequestId()];

    expect([...made].sort()).toEqual(made);
  });
});
