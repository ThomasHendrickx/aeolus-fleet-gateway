'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FLEET_FIELD } from '../../forms/form-state';
import { Switch } from '../../forms/ui/switch';
import { switchPartyTool, type ToolSwitchState } from '../actions';

const IDLE: ToolSwitchState = { kind: 'idle' };

function SubmitSwitch({ isOn, tool }: { isOn: boolean; tool: string }) {
  const status = useFormStatus();
  return <Switch type="submit" isOn={isOn} label={tool} isPending={status.pending} testId="outside-party-tool-switch" />;
}

/**
 * One tool's switch on a server's page, for an approver (aeolus-fleet#1151):
 * a press sends the change at once, the switch says it is on its way, then
 * the row says what the fleet sees now, or why the API refused it.
 */
export function ToolSwitch({ fleetId, party, tool, isOn }: { fleetId: string; party: string; tool: string; isOn: boolean }) {
  const [state, action] = useActionState(switchPartyTool, IDLE);
  const shownOn = state.kind === 'switched' ? state.isOn : isOn;
  return (
    <>
      <form action={action} className="contents">
        <input type="hidden" name={FLEET_FIELD} value={fleetId} />
        <input type="hidden" name="name" value={party} />
        <input type="hidden" name="tool" value={tool} />
        <input type="hidden" name="isOn" value={String(!shownOn)} />
        <SubmitSwitch isOn={shownOn} tool={tool} />
      </form>
      {state.kind === 'idle' ? null : (
        <span role={state.kind === 'refused' ? 'alert' : 'status'} className={`order-last basis-full text-caption ${state.kind === 'refused' ? 'text-tone-attention-fg' : 'text-tone-ok-fg'}`} data-testid="outside-party-tool-outcome">
          {state.message}
        </span>
      )}
    </>
  );
}
