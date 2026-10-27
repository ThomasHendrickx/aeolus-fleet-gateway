import { inFleet } from '../../../lib/gateway-api/page-account';
import { readOf, type SignedInPage } from '../../../lib/gateway-api/page-api';
import { ActionForm } from '../../forms/ui/action-form';
import { BUTTONS, CARD, INPUT, LABEL } from '../../forms/ui/look';
import { StatusBadge } from '../../outside-parties/ui/status-badge';
import { connectSlack, installGatewayBot } from '../actions';
import { installOutcomeOf } from '../install-outcomes';
import { DISCONNECT_SLACK_PATH } from '../paths';

/** What the gateway's bot shows as, by its state. */
const GATEWAY_BOT_STATES = {
  notMade: { tone: 'waiting', label: 'Not made yet' },
  made: { tone: 'waiting', label: 'Waiting for install' },
  installed: { tone: 'ok', label: 'In Slack' },
} as const;

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-tone-attention-border bg-tone-attention-bg px-3 py-2 text-tone-attention-fg">
      {children}
    </p>
  );
}

/** The configuration token's field and Connect, or Connect again once Slack refused the kept one. */
function ConnectForm({ fleetId, label }: { fleetId: string; label: string }) {
  return (
    <ActionForm action={connectSlack} fleetId={fleetId} submit={{ label, pending: 'Connecting…' }} testId="slack-connect-form">
      <label className={LABEL}>
        <span>App configuration refresh token</span>
        <input className={INPUT} type="password" name="refreshToken" required autoComplete="off" data-testid="slack-refresh-token" />
        <span className="text-caption text-muted-foreground">Slack issues it for you and this workspace on its app management page, under Your App Configuration Tokens.</span>
      </label>
    </ActionForm>
  );
}

/**
 * The Slack page (gateway scopes 9.6): the workspace and its configuration
 * token's state, the gateway's bot, Install and Disconnect, for an account
 * holding gateway:slack; the same state, read-only, for others.
 */
export async function Slack({ page, install }: { page: SignedInPage; install: string | undefined }) {
  const { api, fleetId } = page;
  const read = await readOf(api.slack.view.query());
  const outcome = installOutcomeOf(install);
  return (
    <div className="grid gap-4">
      <h1 className="text-title font-semibold">Slack</h1>
      {outcome === undefined ? null : outcome.tone === 'ok' ? (
        <p role="status" className="rounded-md border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-tone-ok-fg" data-testid="slack-install-outcome">
          {outcome.message}
        </p>
      ) : (
        <Alert>{outcome.message}</Alert>
      )}
      {!read.isOk ? (
        <Alert>{read.refusal}</Alert>
      ) : read.value.state === 'notConnected' ? (
        <section className={`${CARD} grid gap-3`} data-testid="slack-not-connected">
          <h2 className="text-heading font-semibold">Connect a Slack workspace</h2>
          <p className="text-muted-foreground">The fleet connects one workspace. With it the gateway makes its own bot, named after the fleet.</p>
          {read.value.canChange ? <ConnectForm fleetId={fleetId} label="Connect" /> : <p className="text-muted-foreground">Connecting Slack needs gateway:slack.</p>}
        </section>
      ) : (
        <>
          <section className={`${CARD} grid gap-3`} data-testid="slack-workspace">
            <h2 className="text-heading font-semibold">{read.value.workspace.name ?? read.value.workspace.teamId}</h2>
            <p className="text-muted-foreground">
              Connected by {read.value.connectedBy} on {new Date(read.value.connectedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            {read.value.tokenState === 'fresh' ? (
              <span>
                <StatusBadge tone="ok" label="Configuration token fresh" />
              </span>
            ) : (
              <>
                <Alert>Slack refused the configuration token. Connect again to make or change bots; bots already installed keep working.</Alert>
                {read.value.canChange ? <ConnectForm fleetId={fleetId} label="Connect again" /> : null}
              </>
            )}
            {read.value.canChange ? (
              <div>
                <a className={BUTTONS.secondary} href={inFleet(DISCONNECT_SLACK_PATH, fleetId)} data-testid="slack-disconnect">
                  Disconnect
                </a>
              </div>
            ) : null}
          </section>
          <section className={`${CARD} grid gap-3`} data-testid="slack-gateway-bot">
            <h2 className="text-heading font-semibold">The gateway&apos;s bot</h2>
            <p className="text-muted-foreground">It shows a person what waits for their person ship, in a direct message.</p>
            <span>
              <StatusBadge tone={GATEWAY_BOT_STATES[read.value.gatewayBot].tone} label={GATEWAY_BOT_STATES[read.value.gatewayBot].label} />
            </span>
            {read.value.canChange && read.value.gatewayBot !== 'installed' && read.value.tokenState === 'fresh' ? (
              <ActionForm action={installGatewayBot} fleetId={fleetId} submit={{ label: 'Install', pending: 'Opening Slack…' }} testId="slack-install-form" />
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
