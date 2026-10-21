'use client';

import { useActionState } from 'react';

import { FLEET_FIELD, IDLE } from '../../forms/form-state';
import { BUTTONS, CARD } from '../../forms/ui/look';
import { Outcome } from '../../forms/ui/outcome';
import { SubmitButton } from '../../forms/ui/submit-button';
import { switchOutsideParties } from '../actions';
import { StatusBadge } from './status-badge';

/** The scope that turns outside parties on or off (0056). */
const SWITCHING_SCOPE = 'fleet:network';

/**
 * Whether the fleet's outside parties are on, and the switch for an account
 * holding fleet:network. An open network's warning asks to confirm, or to
 * keep them off.
 */
export function SwitchCard({ isOn, canSwitch, fleetId }: { isOn: boolean; canSwitch: boolean; fleetId: string }) {
  const [state, formAction] = useActionState(switchOutsideParties, IDLE);
  return (
    <section className={`${CARD} grid gap-3`} data-testid="outside-parties-switch">
      <h2 className="flex items-center gap-2 text-section font-semibold">
        Outside parties are {isOn ? 'on' : 'off'} {isOn ? <StatusBadge tone="ok" label="On" /> : <StatusBadge tone="ended" label="Off" />}
      </h2>
      <p className="text-muted-foreground">
        {isOn ? 'Approved outside MCP servers and clients reach the fleet, as its network rules allow.' : 'No outside MCP server or client reaches the fleet, and no request for one can be approved.'}
      </p>
      {state.kind === 'openNetwork' ? (
        <form action={formAction} role="alert" className="grid gap-3 rounded-md border border-tone-attention-border bg-tone-attention-bg p-4 text-tone-attention-fg">
          <h3 className="font-semibold">Open network</h3>
          <p>{state.message}</p>
          <input type="hidden" name={FLEET_FIELD} value={fleetId} />
          <input type="hidden" name="isOn" value="true" />
          <input type="hidden" name="isOpenNetworkConfirmed" value="true" />
          <div className="flex gap-2">
            <SubmitButton kind="destructive" pending="Turning on…" testId="outside-parties-turn-on-anyway">
              Turn on anyway
            </SubmitButton>
            <a className={BUTTONS.secondary} href="">
              Keep off
            </a>
          </div>
        </form>
      ) : canSwitch ? (
        <form action={formAction}>
          <input type="hidden" name={FLEET_FIELD} value={fleetId} />
          <input type="hidden" name="isOn" value={String(!isOn)} />
          <SubmitButton kind={isOn ? 'secondary' : 'primary'} pending={isOn ? 'Turning off…' : 'Turning on…'} testId="outside-parties-turn">
            {isOn ? 'Turn off' : 'Turn on'}
          </SubmitButton>
        </form>
      ) : (
        <p className="text-muted-foreground">Turning them on or off needs {SWITCHING_SCOPE}.</p>
      )}
      {state.kind === 'openNetwork' ? null : <Outcome state={state} />}
    </section>
  );
}
