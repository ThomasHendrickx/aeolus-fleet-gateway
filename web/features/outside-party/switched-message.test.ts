import { describe, expect, it } from 'vitest';

import { switchedMessageOf } from './switched-message';

describe("what a tool's switch says once it is kept (aeolus-fleet#1151)", () => {
  it('says a tool switched on may be called', () => {
    expect(switchedMessageOf({ tool: 'search_notes', isOn: true, statementRefusal: null })).toBe('search_notes is on: the fleet may call it.');
  });

  it('says a tool switched off is seen no more and refused', () => {
    expect(switchedMessageOf({ tool: 'delete_project', isOn: false, statementRefusal: null })).toBe('delete_project is off: the fleet sees it no more, and a call to it is refused.');
  });

  it('says why the fleet sees it only at the next statement', () => {
    expect(switchedMessageOf({ tool: 'delete_project', isOn: false, statementRefusal: 'The fleet refused the statement: The fleet did not answer' })).toBe(
      "delete_project is off; the fleet sees it at the proxy ship's next statement: The fleet refused the statement: The fleet did not answer",
    );
  });
});
