import { describe, expect, it } from 'vitest';

import { lastReadTimeOf, nextShownOf } from './last-read';

// While the record cannot be read, a page shows what it last read, as last
// read (states.html): the browser keeps what it showed, the gateway keeps no
// copy (Bridge, section 6).

describe('a page part as last read', () => {
  it('shows what was read, and keeps it', () => {
    expect(nextShownOf(undefined, { readAt: '2026-10-31T20:14:00.000Z', part: 'the list' })).toEqual({
      kept: { readAt: '2026-10-31T20:14:00.000Z', part: 'the list' },
      shown: { part: 'the list', lastReadAt: undefined },
    });
  });

  it('shows what it kept, as last read, while the record cannot be read', () => {
    const kept = { readAt: '2026-10-31T20:14:00.000Z', part: 'the list' };

    expect(nextShownOf(kept, { readAt: undefined, part: 'the banner alone' })).toEqual({ kept, shown: { part: 'the list', lastReadAt: '2026-10-31T20:14:00.000Z' } });
  });

  it('shows what the page answered when it read nothing yet', () => {
    expect(nextShownOf(undefined, { readAt: undefined, part: 'the banner alone' })).toEqual({ kept: undefined, shown: { part: 'the banner alone', lastReadAt: undefined } });
  });

  it('keeps the newer read once the record can be read again', () => {
    const kept = { readAt: '2026-10-31T20:14:00.000Z', part: 'the list' };

    expect(nextShownOf(kept, { readAt: '2026-10-31T20:15:00.000Z', part: 'the newer list' }).kept).toEqual({ readAt: '2026-10-31T20:15:00.000Z', part: 'the newer list' });
  });
});

describe('when a page part was last read', () => {
  it('says the time of day in UTC, to the minute', () => {
    expect(lastReadTimeOf('2026-10-31T20:14:59.000Z')).toBe('20:14 UTC');
  });
});
