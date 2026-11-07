import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppMark } from './app-mark';

describe('AppMark', () => {
  it('draws the primary tile with the ship glyph, hidden from assistive technology', () => {
    const html = renderToStaticMarkup(createElement(AppMark));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('bg-primary');
    expect(html).toContain('size-7');
    expect(html).toContain('<svg');
  });

  it('takes a size and extra classes', () => {
    const html = renderToStaticMarkup(createElement(AppMark, { size: 36, className: 'size-10 rounded-md' }));
    expect(html).toContain('size-10');
    expect(html).not.toContain('size-9');
    expect(html).toContain('rounded-md');
  });
});
