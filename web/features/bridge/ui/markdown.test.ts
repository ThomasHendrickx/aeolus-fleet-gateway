import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown } from './markdown';

function render(text: string): string {
  return renderToStaticMarkup(createElement(Markdown, { text }));
}

// A question's context, a step's why and an alert's body render as Markdown (Bridge mockups: decide.html, do.html, stay-aware.html).
describe('Markdown in an opened item (aeolus-fleet#1538)', () => {
  it('shows code as code and emphasis in italics', () => {
    const markup = render('Both touch `@aeolus-fleet/ui`. Its last report: *Working: slice W9*.');

    expect({ code: /<code[^>]*>@aeolus-fleet\/ui<\/code>/.test(markup), italics: markup.includes('<em>Working: slice W9</em>') }).toEqual({ code: true, italics: true });
  });

  it('keeps each paragraph its own', () => {
    expect((render('One.\n\nTwo.').match(/<p[ >]/g) ?? []).length).toBe(2);
  });

  it('opens a link outside Aeolus in a tab of its own, only by the person’s press', () => {
    expect(render('See [the PR](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1497).')).toContain('href="https://github.com/ThomasHendrickx/aeolus-fleet/pull/1497" target="_blank" rel="noopener noreferrer"');
  });

  it('shows HTML in the text as text, never as markup', () => {
    const markup = render('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>');

    expect({ script: markup.includes('<script'), image: markup.includes('<img') }).toEqual({ script: false, image: false });
  });

  it('leads a javascript: link nowhere', () => {
    expect(render('[press](javascript:alert(1))')).not.toContain('javascript:');
  });
});
