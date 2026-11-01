import { describe, expect, it } from 'vitest';

import { memoryArgoAccounts } from '../../../test/support/argo-inbox-fakes.js';
import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createNoteArgoAccount } from './note-argo-account.js';

// The gateway keeps, for each fleet, the accounts allowed as argo with their
// person ships, from each account's latest account token (argo's inbox, AI9).

const CHARLOTTE = { accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID };

describe('an account token the gateway is given', () => {
  it('keeps an account allowed as argo with its person ship', async () => {
    const accounts = memoryArgoAccounts();

    await createNoteArgoAccount({ accounts })(FLEET_ID, { ...CHARLOTTE, isArgoAllowed: true });

    await expect(accounts.list(FLEET_ID)).resolves.toEqual([CHARLOTTE]);
  });

  it('drops an account whose next token says it is no longer allowed as argo', async () => {
    const accounts = memoryArgoAccounts();
    const note = createNoteArgoAccount({ accounts });
    await note(FLEET_ID, { ...CHARLOTTE, isArgoAllowed: true });

    await note(FLEET_ID, { ...CHARLOTTE, isArgoAllowed: false });

    await expect(accounts.list(FLEET_ID)).resolves.toEqual([]);
  });

  it('keeps no account allowed as argo without a person ship, as there is none to reach', async () => {
    const accounts = memoryArgoAccounts();

    await createNoteArgoAccount({ accounts })(FLEET_ID, { accountId: 'acc-charlotte', personShipId: null, isArgoAllowed: true });

    await expect(accounts.list(FLEET_ID)).resolves.toEqual([]);
  });

  it('keeps the account in the fleet the token is for only', async () => {
    const accounts = memoryArgoAccounts();

    await createNoteArgoAccount({ accounts })(FLEET_ID, { ...CHARLOTTE, isArgoAllowed: true });

    await expect(accounts.list(OTHER_FLEET_ID)).resolves.toEqual([]);
  });
});
