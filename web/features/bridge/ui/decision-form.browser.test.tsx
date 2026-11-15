import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../app/globals.css';
import { scopeLabel, type DecisionInput, type ShownRequest } from '../services/requests';
import { DecisionForm } from './decision-form';

// A refused approval leaves the form as the approver filled it: a scope box
// must then show what the next approval sends.

const SCOPE = 'messages:force';

const REQUEST: ShownRequest = {
  fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv',
  requestId: 'req_01m5c7hmbt9f1vrkwb37az0001',
  subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' },
  requesters: [{ accountId: 'acc-charlotte', personShipId: null }],
  askedAt: '2026-10-20T09:00:00.000Z',
  expiresAt: '2026-10-27T09:00:00.000Z',
  state: 'pending',
  decidedBy: null,
  decidedAt: null,
};

/** The decision form as its panel holds it, the first approval refused and the next taken, keeping each approval's scope tick. */
function RefusingTheFirstApproval({ sent }: { sent: string[] }) {
  const [failure, setFailure] = useState<string | undefined>();
  const [isDone, setIsDone] = useState(false);
  const decide = (decision: DecisionInput) => {
    if (decision.kind !== 'approve') {
      return;
    }
    sent.push(decision.scopes.includes(SCOPE) ? 'ticked' : 'unticked');
    if (sent.length === 1) {
      setFailure('The name is taken.');
      return;
    }
    setFailure(undefined);
    setIsDone(true);
  };
  return (
    <>
      <DecisionForm request={REQUEST} heldScopes={[SCOPE]} owners={{ isOk: true, value: [{ shipId: 'shp_01m3tb1zhjs6kthtcs2zvksacv', name: 'argo' }] }} working={undefined} failure={failure} onDecide={decide} />
      {isDone ? <p>Approved.</p> : null}
    </>
  );
}

function scopeBox() {
  return page.getByRole('checkbox', { name: scopeLabel(SCOPE) });
}

describe('a scope box on the decision form', () => {
  it('sends again what it shows once an approval was refused', async () => {
    const sent: string[] = [];
    await render(<RefusingTheFirstApproval sent={sent} />);

    await page.getByTestId('owner-field').selectOptions('argo');
    await scopeBox().click();
    await page.getByTestId('bridge-approve').click();
    await expect.element(page.getByText('The name is taken.')).toBeVisible();
    const shown = scopeBox().element().getAttribute('aria-checked') === 'true' ? 'ticked' : 'unticked';
    await page.getByTestId('bridge-approve').click();
    await expect.element(page.getByText('Approved.')).toBeVisible();

    expect({ shown, sent }).toEqual({ shown: 'ticked', sent: ['ticked', 'ticked'] });
  });
});
