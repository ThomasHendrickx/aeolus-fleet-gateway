/// <reference types="next" />
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../app/globals.css';
import { HomeColumns } from './home-columns';

/** An open question beside its list, as ItemSplit draws it. */
const OPEN_QUESTION = (
  <div data-testid="bridge-split">
    <section data-testid="bridge-delivery">Which time zone do tide alerts use?</section>
  </div>
);

const YOUR_FLEET = <section data-testid="bridge-your-fleet">Your fleet</section>;

/** The widths the hosted onboarding mockups draw Bridge at (M14, M15). */
const WIDTHS = [375, 1440] as const;

describe("Bridge home's columns while a question is open (gateway#404)", () => {
  for (const width of WIDTHS) {
    it(`shows the open question to a person the fleet lets read no Your fleet, at ${String(width)} px`, async () => {
      await page.viewport(width, 900);

      await render(<HomeColumns main={OPEN_QUESTION} aside={null} />);

      await expect.element(page.getByTestId('bridge-delivery')).toBeVisible();
    });

    it(`shows the open question and steps Your fleet out of sight, at ${String(width)} px`, async () => {
      await page.viewport(width, 900);

      await render(<HomeColumns main={OPEN_QUESTION} aside={YOUR_FLEET} />);

      await expect.element(page.getByTestId('bridge-delivery')).toBeVisible();
      await expect.element(page.getByTestId('bridge-your-fleet')).not.toBeVisible();
    });
  }
});
