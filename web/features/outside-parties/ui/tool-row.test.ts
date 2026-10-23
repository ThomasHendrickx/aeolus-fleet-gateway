import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Switch } from '../../forms/ui/switch';
import { ToolRow } from './tool-row';

function textOf(markup: string): string {
  return markup.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

describe("a tool's row, as an approver scans it (aeolus-fleet#1151)", () => {
  it('shows its name, that the server says it reads only, and that it is new', () => {
    const markup = renderToStaticMarkup(createElement(ToolRow, { tool: { name: 'search_notes', isReadOnly: true, isNew: true }, control: null }));

    expect(textOf(markup)).toBe('search_notes reads only New');
  });

  it("shows a description's first line, the whole folded open on a click", () => {
    const markup = renderToStaticMarkup(createElement(ToolRow, { tool: { name: 'write_note', description: 'Writes a note.\nOverwrites one with the same title.', isReadOnly: false }, control: null }));

    expect({ summary: /<summary[^>]*>Writes a note\.<\/summary>/.test(markup), isFolded: markup.includes('<details') }).toEqual({ summary: true, isFolded: true });
  });

  it('shows a one-line description as it is, with nothing to open', () => {
    const markup = renderToStaticMarkup(createElement(ToolRow, { tool: { name: 'read_note', description: 'Reads a note.', isReadOnly: true }, control: null }));

    expect({ text: textOf(markup), isFolded: markup.includes('<details') }).toEqual({ text: 'read_note reads only Reads a note.', isFolded: false });
  });
});

describe('a switch', () => {
  it('says to a screen reader whether it is on, and names what it switches', () => {
    const on = renderToStaticMarkup(createElement(Switch, { isOn: true, label: 'search_notes' }));
    const off = renderToStaticMarkup(createElement(Switch, { isOn: false, label: 'delete_project' }));

    expect([on.includes('role="switch" aria-checked="true" aria-label="search_notes"'), off.includes('aria-checked="false" aria-label="delete_project"')]).toEqual([true, true]);
  });

  it('is busy and takes no second press while its change is on its way', () => {
    const markup = renderToStaticMarkup(createElement(Switch, { isOn: true, label: 'search_notes', isPending: true }));

    expect([markup.includes('aria-busy="true"'), markup.includes('disabled=""')]).toEqual([true, true]);
  });
});
