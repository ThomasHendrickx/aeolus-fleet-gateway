import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ArgoSection } from '../services/argo-section';
import { ArgoSectionPanel } from './argo-section-panel';

// argo's items shown in Bridge follow the person's rule (#240): a question
// withdrawn before Bridge was open never shows.

const NOW = '2026-11-01T20:20:00.000Z';

/** The router the page sits under; a static render never navigates. */
const ROUTER: AppRouterInstance = { back: () => undefined, forward: () => undefined, refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined, bfcacheId: 'argo-section-panel-test' };

const QUESTION: ArgoSection['items'][number] = {
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9002',
  title: 'Which repository holds the memory plugin?',
  from: 'builder-memory',
  sentAt: '2026-11-01T19:55:00.000Z',
  kind: 'question',
  look: 'decide',
  isNew: false,
  stale: null,
  consoleUrl: 'https://fleet.example/inbox?message=dlv_01m3tbfspe96yf1rnr4ank9002',
};

describe("Bridge's argo section as the page shows it (#240)", () => {
  it('never shows a question already withdrawn when the page first read it', () => {
    const section: ArgoSection = { count: 1, items: [{ ...QUESTION, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9003', title: 'Retire walker-2 now, or after its PR merges?', stale: { kind: 'withdrawn', replacementId: null, at: '2026-11-01T20:00:00.000Z', replacementTitle: null } }, QUESTION], done: null };

    const markup = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: ROUTER }, createElement(ArgoSectionPanel, { section, now: NOW })));

    expect({ rows: (markup.match(/data-testid="bridge-argo-item"/g) ?? []).length, withdrawn: markup.includes('Retire walker-2') }).toEqual({ rows: 1, withdrawn: false });
  });
});
