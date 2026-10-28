import { inFleet } from '../../../lib/gateway-api/page-account';
import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { ActionForm } from '../../forms/ui/action-form';
import { BUTTONS, CARD } from '../../forms/ui/look';
import { removeBot } from '../actions';
import { SLACK_PATH } from '../paths';

/** Removing a ship's bot, after one confirm that lists what happens (gateway scopes 9.2). */
export async function RemoveBot({ page, appId }: { page: SignedInPage; appId: string }) {
  const { api, fleetId } = page;
  const read = await readOf(api.slack.view.query());
  const bot = read.isOk && read.value.state === 'connected' ? read.value.bots.find((each) => each.appId === appId) : undefined;
  return (
    <div className="grid gap-4">
      <a href={inFleet(SLACK_PATH, fleetId)} className="text-muted-foreground hover:text-foreground">
        ← Slack
      </a>
      {bot === undefined ? (
        <p role="alert" className="rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg">
          {read.isOk ? 'The gateway made no such bot in this fleet' : read.refusal}
        </p>
      ) : (
        <section className={`${CARD} grid gap-3`}>
          <h2 className="text-heading font-semibold">Remove {bot.shipName} from Slack?</h2>
          <ul className="list-disc pl-5">
            <li>Its bot is removed from the workspace, with its conversations there</li>
            <li>The ship stays in the fleet; exposing it again makes a new bot</li>
          </ul>
          <ActionForm action={removeBot} fleetId={fleetId} submit={{ label: `Remove ${bot.shipName}`, pending: 'Removing…', kind: 'destructive' }} testId="slack-remove-form">
            <input type="hidden" name="appId" value={bot.appId} />
          </ActionForm>
          <div>
            <a className={BUTTONS.secondary} href={inFleet(SLACK_PATH, fleetId)}>
              Cancel
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
