/// <reference types="next" />
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { Suspense, use, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../web/app/globals.css';
import { RecordUnreadable } from './record-unreadable';

/** A route refresh whose server answer stays pending until the test releases it. */
function Refreshed({ answer }: { answer: Promise<boolean> }) {
  const isDisconnected = use(answer);
  return isDisconnected ? <RecordUnreadable whoDidNotAnswer="fleet" isDisconnected /> : <p>Nothing waits on you</p>;
}

const DISCONNECTED = Promise.resolve(true);

function RecoveryRoute({ answer }: { answer: Promise<boolean> }) {
  const [read, setRead] = useState(DISCONNECTED);
  const router: AppRouterInstance = {
    back: () => undefined, forward: () => undefined, push: () => undefined,
    replace: () => undefined, prefetch: () => undefined, bfcacheId: 'recovery-test',
    refresh: () => { setRead(answer); },
  };
  return <AppRouterContext.Provider value={router}><Suspense fallback={<p>Loading Bridge</p>}><Refreshed answer={read} /></Suspense></AppRouterContext.Provider>;
}

describe('Bridge manual connection check (M14)', () => {
  for (const isDisconnected of [true, false]) {
    it(`shows pending until Retry answers ${isDisconnected ? 'still disconnected' : 'ready'}`, async () => {
      let finish: (value: boolean) => void = () => undefined;
      const answer = new Promise<boolean>((resolve) => { finish = resolve; });
      await render(<RecoveryRoute answer={answer} />);
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect.element(page.getByRole('button', { name: /Trying again/ })).toHaveAttribute('aria-disabled', 'true');
      finish(isDisconnected);
      if (isDisconnected) {
        await expect.element(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
        await expect.element(page.getByText('The gateway is not connected to your fleet', { exact: true })).toBeVisible();
      } else {
        await expect.element(page.getByText('Nothing waits on you')).toBeVisible();
      }
    });
  }
});
