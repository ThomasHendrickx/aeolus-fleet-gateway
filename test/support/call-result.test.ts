import { describe, expect, it } from 'vitest';

import { readUntilAnswered } from './call-result.js';

/** A call read once per text, the last repeating. */
const reading = (texts: string[]) => {
  let index = 0;
  return () => Promise.resolve(texts[Math.min(index++, texts.length - 1)] ?? '');
};

describe('readUntilAnswered', () => {
  it('reads again while the ship took the call and its reply is not kept yet (working)', async () => {
    const read = reading(['{"handle":"h","state":"submitted"}', '{"handle":"h","state":"working"}', 'Two deals.']);

    expect(await readUntilAnswered(read, { attempts: 5, pollMs: 1 })).toBe('Two deals.');
  });

  it('answers the last reading once its attempts are used', async () => {
    const read = reading(['{"handle":"h","state":"working"}']);

    expect(await readUntilAnswered(read, { attempts: 3, pollMs: 1 })).toBe('{"handle":"h","state":"working"}');
  });
});
