import { inFleet } from '../../../lib/gateway-api/page-account';
import type { SignedInPage } from '../../../lib/gateway-api/page-api';
import { ActionForm } from '../../forms/ui/action-form';
import { BUTTONS, CARD } from '../../forms/ui/look';
import { disconnectSlack } from '../actions';
import { SLACK_PATH } from '../paths';

/** Disconnecting the fleet's workspace, after one confirm that lists what happens (gateway scopes 9.1). */
export function DisconnectSlack({ page }: { page: SignedInPage }) {
  const { fleetId } = page;
  return (
    <div className="grid gap-4">
      <a href={inFleet(SLACK_PATH, fleetId)} className="text-muted-foreground hover:text-foreground">
        ← Slack
      </a>
      <section className={`${CARD} grid gap-3`}>
        <h2 className="text-heading font-semibold">Disconnect Slack?</h2>
        <ul className="list-disc pl-5">
          <li>Every bot the gateway made is removed from the workspace, the gateway&apos;s own bot too</li>
          <li>Connecting again is a new configuration token</li>
        </ul>
        <ActionForm action={disconnectSlack} fleetId={fleetId} submit={{ label: 'Disconnect Slack', pending: 'Disconnecting…', kind: 'destructive' }} testId="slack-disconnect-form" />
        <div>
          <a className={BUTTONS.secondary} href={inFleet(SLACK_PATH, fleetId)}>
            Cancel
          </a>
        </div>
      </section>
    </div>
  );
}
