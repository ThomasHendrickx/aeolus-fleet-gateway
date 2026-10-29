import { describe, expect, it } from 'vitest';

import { markedMessageOf } from './marked-message';

describe("what an A2A agent's repeatable mark says once it is kept (A9)", () => {
  it('says a message to an agent marked repeatable is handed again when it died unconfirmed', () => {
    expect(markedMessageOf({ name: 'supplier', isRepeatable: true, statementRefusal: null })).toBe('supplier is repeatable: a message that died before it confirmed it is handed again.');
  });

  it('says a message to an agent marked not repeatable is not handed again', () => {
    expect(markedMessageOf({ name: 'supplier', isRepeatable: false, statementRefusal: null })).toBe('supplier is not repeatable: a message that died before it confirmed it is not handed again, as it may have run.');
  });

  it('says why the fleet sees the mark only at the next statement', () => {
    expect(markedMessageOf({ name: 'supplier', isRepeatable: false, statementRefusal: 'The card of supplier could not be read: connection refused' })).toBe(
      "supplier is not repeatable; the fleet sees it at the proxy ship's next statement: The card of supplier could not be read: connection refused",
    );
  });
});
