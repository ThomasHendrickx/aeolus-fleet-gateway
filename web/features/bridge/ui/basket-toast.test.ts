import { describe, expect, it } from 'vitest';

import { putToastOf } from './basket-toast';

// What the toast says once an answer is in the basket (basket.html, In the
// basket): what went in, and that it is not sent and still waits.

describe('the toast once an answer is in the basket', () => {
  it('names the option put in the basket, not sent and still waiting', () => {
    expect(putToastOf(2)).toEqual({ title: 'Option 2 in the basket', description: 'Not sent. Still waiting on you until you send it.' });
  });

  it('names the note alone put in the basket', () => {
    expect(putToastOf(null)).toEqual({ title: 'Your note alone in the basket', description: 'Not sent. Still waiting on you until you send it.' });
  });
});
