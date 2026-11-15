'use client';

import { Switch } from '@aeolus-fleet/ui';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { FLEET_FIELD } from '../../forms/form-state';
import { markA2aAgent, type MarkState } from '../actions';

const IDLE: MarkState = { kind: 'idle' };

function SubmitSwitch({ isRepeatable }: { isRepeatable: boolean }) {
  const status = useFormStatus();
  return <Switch onClick={(event) => { event.currentTarget.closest('form')?.requestSubmit(); }} checked={isRepeatable} aria-label="Repeatable" disabled={status.pending} aria-busy={status.pending} data-testid="outside-party-repeatable-switch" />;
}

/**
 * An A2A agent's repeatable mark on its page, for an approver (A9): a press
 * sends the change at once, the switch says it is on its way, then the row
 * says what it means now, or why the API refused it.
 */
export function RepeatableSwitch({ fleetId, party, isRepeatable }: { fleetId: string; party: string; isRepeatable: boolean }) {
  const [state, action] = useActionState(markA2aAgent, IDLE);
  const shown = state.kind === 'marked' ? state.isRepeatable : isRepeatable;
  return (
    <>
      <form action={action} className="contents">
        <input type="hidden" name={FLEET_FIELD} value={fleetId} />
        <input type="hidden" name="name" value={party} />
        <input type="hidden" name="isRepeatable" value={String(!shown)} />
        <SubmitSwitch isRepeatable={shown} />
      </form>
      {state.kind === 'idle' ? null : (
        <span role={state.kind === 'refused' ? 'alert' : 'status'} className={`basis-full text-caption ${state.kind === 'refused' ? 'text-tone-attention-fg' : 'text-tone-ok-fg'}`} data-testid="outside-party-repeatable-outcome">
          {state.message}
        </span>
      )}
    </>
  );
}
