import { InlineError } from '@aeolus-fleet/ui';

import { inFleet } from '../../../lib/gateway-api/page-account';
import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { ActionForm } from '../../forms/ui/action-form';
import { BUTTONS, CARD } from '../../forms/ui/look';
import { exposeShip } from '../actions';
import { SLACK_PATH } from '../paths';
import { ShipPicker } from './ship-picker';

function Back({ fleetId }: { fleetId: string }) {
  return (
    <a href={inFleet(SLACK_PATH, fleetId)} className="text-muted-foreground hover:text-foreground">
      ← Slack
    </a>
  );
}

/**
 * Expose a ship (gateway scopes 9.2): an agent ship or an outside A2A
 * agent's proxy ship, picked by name; the gateway makes its Slack app, to
 * install next. Whether the account manages the ship, the fleet answers.
 */
export async function ExposeShip({ page }: { page: SignedInPage }) {
  const { api, fleetId } = page;
  const offered = await readOf(api.slack.exposable.query());
  return (
    <div className="grid gap-4">
      <Back fleetId={fleetId} />
      <section className={`${CARD} grid gap-3`}>
        <h2 className="text-heading font-semibold">Expose a ship as a Slack bot</h2>
        <p className="text-muted-foreground">Its bot takes its name and its statement&apos;s summary. People who linked their Slack account message it directly, or mention it in a channel it was added to.</p>
        {!offered.isOk ? (
          <div><InlineError title={offered.refusal} variant="section" /></div>
        ) : offered.value.length === 0 ? (
          <p className="text-muted-foreground">No agent ship or A2A agent is left to expose.</p>
        ) : (
          <ActionForm action={exposeShip} fleetId={fleetId} submit={{ label: 'Expose', pending: 'Making its bot…' }} testId="slack-expose-form">
            <ShipPicker ships={offered.value} />
          </ActionForm>
        )}
        <div>
          <a className={BUTTONS.secondary} href={inFleet(SLACK_PATH, fleetId)}>
            Cancel
          </a>
        </div>
      </section>
    </div>
  );
}
