import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { UnreadableBanner } from './unreadable-banner';

// The record cannot be read now (states.html): the banner's words once,
// without core's error text; the phone's shorter words.

function textOf(markup: string, testId: string): string | undefined {
  return new RegExp(`<[^>]*data-testid="${testId}"[^>]*>(.*?)</span>`).exec(markup)?.[1];
}

function bannerOf(whoDidNotAnswer: 'fleet' | 'gateway'): string {
  return renderToStaticMarkup(createElement(UnreadableBanner, { whoDidNotAnswer, tryNow: null }));
}

describe('the record cannot be read now', () => {
  it('says once that the fleet did not answer, that nothing is lost and when Bridge tries again', () => {
    expect(textOf(bannerOf('fleet'), 'bridge-unreadable-why')).toBe('The fleet did not answer. Nothing was opened or answered, so nothing is lost; Bridge tries again in 10 s.');
  });

  it('says the gateway did not answer when it was the gateway', () => {
    expect(textOf(bannerOf('gateway'), 'bridge-unreadable-why')).toBe('The gateway did not answer. Nothing was opened or answered, so nothing is lost; Bridge tries again in 10 s.');
  });

  it("says it shorter on the phone", () => {
    expect(textOf(bannerOf('fleet'), 'bridge-unreadable-why-phone')).toBe('Nothing is lost. Trying again in 10 s.');
  });
});
