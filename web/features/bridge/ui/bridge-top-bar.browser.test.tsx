import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../app/globals.css';
import { BridgeTopBar } from './bridge-top-bar';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';

/** Bridge's top bar on home, counting how often its search asks for the palette. */
async function topBar(width: number) {
  await page.viewport(width, 800);
  const asked: string[] = [];
  await render(<BridgeTopBar fleetId={FLEET} fleetName="Acme fleet" screen="home" isLive={false} opened={undefined} phoneAction={null} avatar={null} onSearch={() => asked.push('palette')} />);
  return asked;
}

describe("Bridge's top bar, searching every app the account may open (header-across-apps, the approved sheets)", () => {
  it('offers the search field with its ⌘K hint on desktop, which opens the palette', async () => {
    const asked = await topBar(1440);

    await expect.element(page.getByTestId('bridge-search')).toHaveTextContent('Search or jump to⌘K');
    await page.getByTestId('bridge-search').click();

    expect(asked).toEqual(['palette']);
  });

  it('offers the search button on the phone, which opens the palette', async () => {
    const asked = await topBar(375);

    await expect.element(page.getByTestId('bridge-search')).not.toBeVisible();
    await page.getByRole('button', { name: 'Search or jump to' }).click();

    expect(asked).toEqual(['palette']);
  });
});
