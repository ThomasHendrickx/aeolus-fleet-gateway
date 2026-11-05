import { describe, expect, it } from 'vitest';

import { HOME_MESSAGES, isPlainMessageType, messageAddressOf, markedDoneSaidOf, markSeenDoneOf, notMarkedDoneOf, messagesPageSaidOf, messagesSaidOf, newMessagesSaidOf, plainTextOf, showAllSaidOf } from './messages';

// Plain messages in Bridge (#242, design/bridge-messages): their first line as
// the title with Markdown marks taken off, outside the count, the 3 newest on
// home, every one on the Messages page, and the seen ones marked done in one go.

describe('a plain message as Bridge lists it', () => {
  it('takes the Markdown marks off its title and text', () => {
    expect(plainTextOf('# Staging is **green** again after `the migration`, see [the run](https://ci.example/1)')).toBe('Staging is green again after the migration, see the run');
  });

  it('takes list and quote marks off each line, and keeps the words of a line', () => {
    expect(plainTextOf('- Records moved: 18 204\n> 1. Slowest step: the delivery index, 41 s')).toBe('Records moved: 18 204 Slowest step: the delivery index, 41 s');
  });

  it('keeps a plain line as written', () => {
    expect(plainTextOf('Thanks: the basket sheet is merged')).toBe('Thanks: the basket sheet is merged');
  });
});

describe('Messages on home', () => {
  it('lists the 3 newest on home', () => {
    expect(HOME_MESSAGES).toBe(3);
  });

  it('says how many are new, outside the count', () => {
    expect([messagesSaidOf(1), messagesSaidOf(0)]).toEqual(['1 new, outside the count', 'outside the count']);
  });

  it('leads to every message', () => {
    expect(showAllSaidOf(20)).toBe('Show all 20 messages');
  });

  it('says on a phone how many new messages wait below', () => {
    expect([newMessagesSaidOf(8), newMessagesSaidOf(1)]).toEqual(['8 new messages', '1 new message']);
  });
});

describe('the Messages page', () => {
  it('says how many are new and seen, and that each stays until done', () => {
    expect([messagesPageSaidOf({ newCount: 8, seenCount: 12 }), messagesPageSaidOf({ newCount: 8, seenCount: 0 }), messagesPageSaidOf({ newCount: 0, seenCount: 2 })]).toEqual([
      '8 new, 12 seen. Outside the count; each stays until you mark it done.',
      '8 new. Outside the count; each stays until you mark it done.',
      '2 seen. Outside the count; each stays until you mark it done.',
    ]);
  });

  it('asks before marking the seen ones done, the new ones staying', () => {
    expect(markSeenDoneOf({ seenCount: 12, newCount: 8 })).toEqual({ button: 'Mark the 12 seen done', question: 'Mark the 12 seen messages done? The 8 new ones stay.', confirm: 'Mark 12 done', pending: 'Marking done...' });
  });

  it('asks for one seen message in the singular, with no new one', () => {
    expect(markSeenDoneOf({ seenCount: 1, newCount: 0 }).question).toBe('Mark the 1 seen message done?');
  });
});

describe('marking the seen ones done, once done', () => {
  it('says what it did, and that they are in Done', () => {
    expect(markedDoneSaidOf({ done: 12, failed: [] })).toBe('12 messages marked done. They are in Done.');
  });

  it('says which it could not mark, and keeps them', () => {
    expect(markedDoneSaidOf({ done: 10, failed: ['Quiet night: no alerts', 'Memory plugin draft README'] })).toBe('10 messages marked done. They are in Done. Not marked done: “Quiet night: no alerts”, “Memory plugin draft README”; the fleet did not answer. Try again.');
  });
});

describe('a Done in place that did not end the message (#242 review)', () => {
  it('says the fleet did not answer when it gave no words, and to try again', () => {
    expect(notMarkedDoneOf(undefined)).toBe('Not marked done: the fleet did not answer. Try again.');
  });

  it('says the fleet\'s own words, and to try again', () => {
    expect(notMarkedDoneOf('The fleet did not take that you dealt with it: busy.')).toBe('Not marked done: the fleet did not take that you dealt with it: busy. Try again.');
  });
});

describe('which opened items are plain messages', () => {
  it('knows text/plain and text/markdown, with parameters, and nothing else', () => {
    expect([isPlainMessageType('text/markdown; charset=utf-8'), isPlainMessageType('TEXT/PLAIN'), isPlainMessageType('application/json')]).toEqual([true, true, false]);
  });
});

describe('opening a message from home (#242 review)', () => {
  it('opens it on the Messages page, the address naming it', () => {
    expect(messageAddressOf({ fleetId: 'flt_01', deliveryId: 'dlv_11' })).toBe('/bridge/messages?fleet=flt_01&item=dlv_11');
  });
});
