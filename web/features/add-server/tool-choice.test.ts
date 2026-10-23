import { describe, expect, it } from 'vitest';

import { firstLineOf, TOOL_ON_FIELD, TOOL_SHOWN_FIELD, toolChoiceOf } from './tool-choice';

function aForm(shown: string[], on: string[]): FormData {
  const form = new FormData();
  shown.forEach((tool) => { form.append(TOOL_SHOWN_FIELD, tool); });
  on.forEach((tool) => { form.append(TOOL_ON_FIELD, tool); });
  return form;
}

describe('the tools an approver switched when adding a server (aeolus-fleet#1151)', () => {
  it('is each tool shown, on when ticked and off when not', () => {
    expect(toolChoiceOf(aForm(['list_notes', 'delete_project'], ['list_notes']))).toEqual([
      { name: 'list_notes', isOn: true },
      { name: 'delete_project', isOn: false },
    ]);
  });

  it('is none when no switch was shown, so the server keeps every tool on', () => {
    expect(toolChoiceOf(aForm([], []))).toBeUndefined();
  });

  it('takes no ticked tool that was not shown', () => {
    expect(toolChoiceOf(aForm(['list_notes'], ['list_notes', 'delete_project']))).toEqual([{ name: 'list_notes', isOn: true }]);
  });
});

describe("a tool's description in its row", () => {
  it('is its first line', () => {
    expect(firstLineOf('Search notes.\nTakes a query and a project.')).toBe('Search notes.');
  });

  it('skips blank lines before the first', () => {
    expect(firstLineOf('\n  \n  Search notes.  \nMore.')).toBe('Search notes.');
  });
});
