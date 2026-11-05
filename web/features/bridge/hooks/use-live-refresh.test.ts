import { describe, expect, it } from 'vitest';

import { changesFollowerOf, type ChangesFollower } from './use-live-refresh';

/** A page following its stream: how often it read itself again, whether it says it is live, and what it hears of the stream. */
function aPage(): { readonly page: { readsAgain: number; isLive: boolean }; readonly stream: ChangesFollower } {
  const page = { readsAgain: 0, isLive: false };
  const stream = changesFollowerOf({ readAgain: () => { page.readsAgain += 1; }, showLive: (isLive) => { page.isLive = isLive; } });
  return { page, stream };
}

describe('Bridge following its changes (aeolus-fleet#1661)', () => {
  it('reads itself again when its stream opens again after it dropped, as a phone drops it while locked or in the background', () => {
    const { page, stream } = aPage();
    stream.opened();

    stream.dropped();
    stream.opened();

    expect(page).toEqual({ readsAgain: 1, isLive: true });
  });

  it('reads itself again once when its stream opens after it dropped more than once in a row', () => {
    const { page, stream } = aPage();
    stream.opened();

    stream.dropped();
    stream.dropped();
    stream.opened();

    expect(page).toEqual({ readsAgain: 1, isLive: true });
  });

  it('does not read itself again when its stream first opens: the page was just read', () => {
    const { page, stream } = aPage();

    stream.opened();

    expect(page).toEqual({ readsAgain: 0, isLive: true });
  });

  it('reads itself again for each change its stream tells', () => {
    const { page, stream } = aPage();
    stream.opened();

    stream.changed();
    stream.changed();

    expect(page).toEqual({ readsAgain: 2, isLive: true });
  });

  it('is not live while its stream is dropped', () => {
    const { page, stream } = aPage();
    stream.opened();

    stream.dropped();

    expect(page).toEqual({ readsAgain: 0, isLive: false });
  });
});
