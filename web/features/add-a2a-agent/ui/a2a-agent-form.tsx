'use client';

import { useActionState } from 'react';

import { FLEET_FIELD } from '../../forms/form-state';
import { CredentialFields } from '../../forms/ui/credential-fields';
import { CARD, INPUT, LABEL } from '../../forms/ui/look';
import { Outcome } from '../../forms/ui/outcome';
import { OwnerField, type OwnerChoices } from '../../forms/ui/owner-field';
import { SubmitButton } from '../../forms/ui/submit-button';
import { SCOPE_FIELD_PREFIX } from '../../outside-party/scope-changes';
import { addA2aAgent, type AddA2aAgentState } from '../actions';

const IDLE: AddA2aAgentState = { kind: 'idle' };

const CONCURRENCY_LIMIT_DEFAULT = '4';

/** The form that adds an A2A agent: its name, card address, credential and calls at once, its owner and the approver's own scopes to tick. */
export function A2aAgentForm({ fleetId, requestId, owners, scopes }: { fleetId: string; requestId: string; owners: OwnerChoices; scopes: readonly string[] }) {
  const [state, action] = useActionState(addA2aAgent, IDLE);
  const fields = state.kind === 'refused' ? state.fields : {};
  return (
    <form action={action} className={`${CARD} grid gap-3`} data-testid="add-a2a-agent-form">
      <input type="hidden" name={FLEET_FIELD} value={fleetId} />
      <input type="hidden" name="requestId" value={requestId} />
      <h1 className="text-title font-semibold">Add an A2A agent</h1>
      <Outcome state={state.kind === 'refused' ? state : { kind: 'idle' }} />
      <label className={LABEL}>
        <span>Name, the proxy ship&apos;s</span>
        <input className={INPUT} name="name" defaultValue={fields.name ?? ''} required />
      </label>
      <label className={LABEL}>
        <span>Card address</span>
        <input className={INPUT} type="url" name="cardUrl" defaultValue={fields.cardUrl ?? ''} placeholder="https://agent.example.com/.well-known/agent-card.json" required />
        <span className="text-caption text-muted-foreground">The gateway reads the card first: an agent whose card it cannot state is not added.</span>
      </label>
      <CredentialFields legend="The agent's credential" fields={fields} noneHelp="The gateway sends no credential: for an agent that asks for none." />
      <label className={LABEL}>
        <span>Messages in flight at once</span>
        <input className={INPUT} type="number" name="concurrencyLimit" min={1} max={10} defaultValue={fields.concurrencyLimit ?? CONCURRENCY_LIMIT_DEFAULT} />
      </label>
      <OwnerField choices={owners.isOk ? owners.value : []} current={null} help="A person ship or argo. It answers for this agent." refusal={owners.isOk ? undefined : owners.refusal} />
      {scopes.length === 0 ? null : (
        <fieldset className="grid gap-2">
          <legend className="font-medium">Scopes, beside sending and receiving</legend>
          {scopes.map((scope) => (
            <label key={scope} className="flex items-center gap-2">
              <input type="checkbox" name={`${SCOPE_FIELD_PREFIX}${scope}`} defaultChecked={fields[`${SCOPE_FIELD_PREFIX}${scope}`] !== undefined} />
              <span className="font-mono text-code">{scope}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <SubmitButton pending="Reading the card…">Add</SubmitButton>
      </div>
    </form>
  );
}
