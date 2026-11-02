import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CredentialFields } from './credential-fields';

function fields(): string {
  return renderToStaticMarkup(createElement(CredentialFields, { legend: "The server's credential", fields: {}, noneHelp: 'No credential.', canEachPersonSignIn: true }));
}

describe("a server's credential, as Add MCP server draws it (design/bridge-navigation)", () => {
  it('labels its kind once, by the legend, with no second Credential label', () => {
    const markup = fields();

    expect({ second: markup.includes('<span>Credential</span>'), named: /<select[^>]*aria-label="The server&#x27;s credential"/.test(markup) }).toEqual({ second: false, named: true });
  });

  it('shows its kind in the body font with the design system chevron, not the browser one', () => {
    const select = /<select[^>]*>/.exec(fields())?.[0] ?? '';

    expect([select.includes('font-mono'), select.includes('appearance-none'), fields().includes('lucide-chevron-down')]).toEqual([false, true, true]);
  });
});
