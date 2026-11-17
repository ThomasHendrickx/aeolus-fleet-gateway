import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Disconnected } from './disconnected';

describe('Bridge disconnected recovery (M14)', () => {
  it('names the recovery without offering to connect automatically', () => {
    const markup = renderToStaticMarkup(createElement(Disconnected, { isRetrying: false, onRetry: () => undefined }));
    expect(markup).toContain('The gateway is not connected to your fleet');
    expect(markup).toContain('A fleet manager can connect the gateway in Console Settings. Ask your builder if you cannot manage this fleet.');
    expect(markup).toContain('Try again');
    expect(markup).not.toContain('href=');
    expect(markup).not.toContain('fleet did not answer');
  });

  it('disables Retry and shows working feedback until the status check answers', () => {
    const markup = renderToStaticMarkup(createElement(Disconnected, { isRetrying: true, onRetry: () => undefined }));
    expect(markup).toContain('Trying again');
    expect(markup).toContain('disabled');
  });
});
