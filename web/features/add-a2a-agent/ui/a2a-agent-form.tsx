'use client';

import { useId, useActionState } from 'react';

import { Input, Label, InlineError, type ListedScope } from '@aeolus-fleet/ui';

import { FLEET_FIELD } from '../../forms/form-state';
import { CredentialFields } from '../../forms/ui/credential-fields';
import { FormCheckbox } from '../../forms/ui/form-checkbox';
import { CARD, INPUT, LABEL } from '../../forms/ui/look';
import { Outcome } from '../../forms/ui/outcome';
import { OwnerField, type OwnerChoices } from '../../forms/ui/owner-field';
import { SubmitButton } from '../../forms/ui/submit-button';
import { SCOPE_FIELD_PREFIX } from '../../outside-party/scope-changes';
import { addA2aAgent, type AddA2aAgentState } from '../actions';

const IDLE: AddA2aAgentState = { kind: 'idle' };

const CONCURRENCY_LIMIT_DEFAULT = '4';

/** The form that adds an A2A agent: its name, card address, credential and calls at once, its owner and the approver's own scopes to tick. */
export function A2aAgentForm({ fleetId, requestId, owners, scopes, listed, scopeRefusal }: { fleetId: string; requestId: string; owners: OwnerChoices; scopes: readonly string[]; listed: readonly ListedScope[]; scopeRefusal?: string | undefined }) {
  const fieldId = useId();
  const [state, action] = useActionState(addA2aAgent, IDLE);
  const fields = state.kind === 'refused' ? state.fields : {};
  return (
    <form action={action} className={`${CARD} grid max-w-160 gap-3`} data-testid="add-a2a-agent-form">
      <input type="hidden" name={FLEET_FIELD} value={fleetId} />
      <input type="hidden" name="requestId" value={requestId} />
      <h1 className="text-heading-touch font-semibold max-sm:sr-only">Add an A2A agent</h1>
      <Outcome state={state.kind === 'refused' ? state : { kind: 'idle' }} />
      <Label htmlFor={fieldId + '-0'} className={LABEL}>
        <span>Name, the proxy ship&apos;s</span>
        <Input id={fieldId + '-0'} className={INPUT} name="name" defaultValue={fields.name ?? ''} required />
      </Label>
      <Label htmlFor={fieldId + '-1'} className={LABEL}>
        <span>Card address</span>
        <Input id={fieldId + '-1'} className={INPUT} type="url" name="cardUrl" defaultValue={fields.cardUrl ?? ''} placeholder="https://agent.example.com/.well-known/agent-card.json" required />
        <span className="text-caption text-muted-foreground">The gateway reads the card first: an agent whose card it cannot state is not added.</span>
      </Label>
      <CredentialFields legend="The agent's credential" fields={fields} noneHelp="The gateway sends no credential: for an agent that asks for none." />
      <Label htmlFor={fieldId + '-2'} className={LABEL}>
        <span>Messages in flight at once</span>
        <Input id={fieldId + '-2'} className={INPUT} type="number" name="concurrencyLimit" min={1} max={10} defaultValue={fields.concurrencyLimit ?? CONCURRENCY_LIMIT_DEFAULT} />
      </Label>
      <OwnerField choices={owners.isOk ? owners.value : []} current={null} help="A person ship or argo. It answers for this agent." refusal={owners.isOk ? undefined : owners.refusal} />
      {scopes.length === 0 ? null : (
        <fieldset className="grid gap-2">
          {scopeRefusal === undefined ? null : <InlineError title={scopeRefusal} variant="section" />}
          <legend className="font-medium">Scopes, beside sending and receiving</legend>
          {scopes.map((scope) => (
            <Label htmlFor={fieldId + '-3' + "-" + (scope)} key={scope} className="flex items-center gap-2">
              <FormCheckbox id={fieldId + '-3' + "-" + (scope)} name={`${SCOPE_FIELD_PREFIX}${scope}`} defaultChecked={fields[`${SCOPE_FIELD_PREFIX}${scope}`] !== undefined} />
              <span className="grid gap-0.5"><span className="font-mono text-code">{scope}</span><span className="text-caption text-muted-foreground">{listed.find((item) => item.scope === scope)?.description ?? "Description unavailable"}</span></span>
            </Label>
          ))}
        </fieldset>
      )}
      <div>
        <SubmitButton pending="Reading the card…">Add</SubmitButton>
      </div>
    </form>
  );
}
