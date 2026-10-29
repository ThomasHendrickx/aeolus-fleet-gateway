import { describe, expect, it } from 'vitest';

import { standingRefusal } from './table-dialog';

const CONFLICT = { message: 'The requirements changed since you opened this page', isConflict: true, version: 3 };

describe("a dialog's refusal, once the page reads itself again (gateway scopes 4.3)", () => {
  it('keeps a CONFLICT while the page still holds the requirements the change was made on', () => {
    expect(standingRefusal(CONFLICT, 3)).toEqual(CONFLICT);
  });

  it('answers a CONFLICT once the page read newer requirements, so the change can be made on them', () => {
    expect(standingRefusal(CONFLICT, 4)).toBeNull();
  });

  it('keeps any other refusal, whatever the page read since', () => {
    const notListed = { message: 'The fleet lists no scope crm:export: define it first, or pick a listed one', isConflict: false, version: 3 };

    expect(standingRefusal(notListed, 5)).toEqual(notListed);
  });
});
