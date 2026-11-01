import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ArgoSection } from '../services/argo-section';
import { ArgoSectionList } from './argo-section';

// Bridge's argo section (argo-inbox mockups, bridge.html, after): what waits
// at argo below the person's own, with its own count, each item marked For
// argo, its kind and sender, one button to act on it in the console as
// argo; and, once one is done at argo, who did it and where.

const NOW = '2026-11-01T20:20:00.000Z';

function anItem(overrides: Partial<ArgoSection['items'][number]> = {}): ArgoSection['items'][number] {
  return {
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9001',
    title: 'thomas-mac is low on disk: 4% free',
    from: 'trierarch thomas-mac',
    sentAt: '2026-11-01T20:16:00.000Z',
    kind: 'report',
    look: 'alert',
    isNew: true,
    stale: null,
    consoleUrl: 'https://fleet.example/inbox?message=dlv_01m3tbfspe96yf1rnr4ank9001',
    ...overrides,
  };
}

const QUESTION = anItem({
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9002',
  title: 'Which repository holds the memory plugin?',
  from: 'builder-memory',
  sentAt: '2026-11-01T19:55:00.000Z',
  kind: 'question',
  look: 'decide',
  consoleUrl: 'https://fleet.example/inbox?message=dlv_01m3tbfspe96yf1rnr4ank9002',
});

function sectionOf(section: ArgoSection): string {
  return renderToStaticMarkup(createElement(ArgoSectionList, { section, now: NOW }));
}

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Each item's words, and where its one button leads. */
function itemsOf(markup: string): { text: string; href: string | undefined }[] {
  return [...markup.matchAll(/<li[^>]*data-testid="bridge-argo-item"[^>]*>(.*?)<\/li>/g)].map(([, inner = '']) => ({ text: textOf(inner), href: /href="([^"]*)"/.exec(inner)?.[1] }));
}

describe("Bridge's argo section", () => {
  it('heads what waits at argo with its own count, not the person’s', () => {
    const text = textOf(sectionOf({ count: 2, items: [anItem(), QUESTION], done: null }));

    expect(text).toContain("Waits at argo 2 Not yours: argo's, for everyone allowed as argo. Outside your count.");
  });

  it('marks each item For argo with its kind and sender, and gives a report Open and a question Answer in the console as argo', () => {
    const items = itemsOf(sectionOf({ count: 2, items: [anItem(), QUESTION], done: null }));

    expect(items).toEqual([
      { text: 'New thomas-mac is low on disk: 4% free For argo · Report · trierarch thomas-mac 4 min Open in the console as argo', href: 'https://fleet.example/inbox?message=dlv_01m3tbfspe96yf1rnr4ank9001' },
      { text: 'New Which repository holds the memory plugin? For argo · Question · builder-memory 25 min Answer in the console as argo', href: 'https://fleet.example/inbox?message=dlv_01m3tbfspe96yf1rnr4ank9002' },
    ]);
  });

  it('says under the list that acting signs in to the console as argo, ending anyone else’s sign-in', () => {
    expect(textOf(sectionOf({ count: 1, items: [anItem()], done: null }))).toContain("Acting signs you in to the console as argo; it ends anyone else's sign-in as argo.");
  });

  it('says who did the message done at argo, where and when, by its title cut at its first colon, and that it left the list for everyone', () => {
    const text = textOf(sectionOf({ count: 1, items: [QUESTION], done: { title: 'thomas-mac is low on disk: 4% free', at: '2026-11-01T20:14:00.000Z', by: 'Mathilde', isInConsole: true } }));

    expect(text).toContain('Done at argo by Mathilde in the console, 20:14: thomas-mac is low on disk. Gone from this list for everyone allowed as argo.');
  });

  it('says the done message by its whole title when it has no colon, and on a phone without where', () => {
    const text = textOf(sectionOf({ count: 0, items: [], done: { title: 'Flagship design-sq was released', at: '2026-11-01T20:14:00.000Z', by: 'Mathilde', isInConsole: true } }));

    expect(text).toContain('Done at argo by Mathilde, 20:14: Flagship design-sq was released.');
  });

  it('marks a stale question withdrawn, as the console does', () => {
    const [item] = itemsOf(sectionOf({ count: 0, items: [{ ...QUESTION, isNew: false, stale: { kind: 'withdrawn', replacementId: null, at: '2026-11-01T20:00:00.000Z', replacementTitle: null } }], done: null }));

    expect(item?.text).toBe('Which repository holds the memory plugin? For argo · Question · builder-memory · Withdrawn 25 min Answer in the console as argo');
  });
});
