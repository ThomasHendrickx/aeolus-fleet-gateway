import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SignInFailed } from './sign-in-failed';

function reasonSaid(reason: string | undefined): string | undefined {
  const markup = renderToStaticMarkup(createElement(SignInFailed, { reason }));
  return /data-testid="sign-in-failed-reason"[^>]*>(.*?)<\/p>/.exec(markup)?.[1];
}

describe('why a sign-in did not go through, as the failed page says it', () => {
  it('says why for a reason the gateway names', () => {
    expect(reasonSaid('pagasaeRefused')).toBe('The sign-in service did not sign you in.');
  });

  it.each(['__proto__', 'constructor', 'toString'])('says the sign-in did not go through for the reason %s, which is no reason it names', (reason) => {
    expect(reasonSaid(reason)).toBe('The sign-in did not go through.');
  });

  it('says the sign-in did not go through when no reason is given', () => {
    expect(reasonSaid(undefined)).toBe('The sign-in did not go through.');
  });
});
