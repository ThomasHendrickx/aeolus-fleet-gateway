'use client';

import { useId, useActionState } from 'react';

import { CORE_SCOPE_DESCRIPTIONS } from '@aeolus-fleet/common';
import { Input, Label, type ListedScope } from '@aeolus-fleet/ui';

import { inFleet } from '../../../web/lib/gateway-api/page-account';
import { FLEET_FIELD } from '../../../web/features/forms/form-state';
import { FormCheckbox } from '../../../web/features/forms/ui/form-checkbox';
import { CARD, INPUT, LABEL } from '../../../web/features/forms/ui/look';
import { Outcome } from '../../../web/features/forms/ui/outcome';
import { OwnerField, type OwnerChoices } from '../../../web/features/forms/ui/owner-field';
import { SubmitButton } from '../../../web/features/forms/ui/submit-button';
import { partyPath } from '../../../web/features/outside-parties/paths';
import { SCOPE_FIELD_PREFIX } from '../../../web/features/outside-party/scope-changes';
import { addA2aClient, type AddA2aClientState } from '../../../web/features/add-a2a-client/actions';

const IDLE: AddA2aClientState = { kind: 'idle' };
const STATIC_DESCRIPTIONS = new Map<string, string>(Object.entries(CORE_SCOPE_DESCRIPTIONS));

/** The bearer, shown this once: the gateway keeps only its hash. */
function Added({ name, bearer, fleetId }: { name: string; bearer: string; fleetId: string }) {
  return (
    <section className={`${CARD} grid gap-3`} data-testid="add-a2a-client-added">
      <h2 className="text-section font-semibold">{name} is added</h2>
      <p>Hand its client this bearer now. It is shown only once: the gateway keeps no copy it can show again.</p>
      <code className="break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-code" data-testid="add-a2a-client-bearer">
        {bearer}
      </code>
      <p>
        <a href={inFleet(partyPath(name), fleetId)} className="text-primary hover:underline">
          Its card addresses
        </a>
      </p>
    </section>
  );
}

/** The form that adds an A2A client: its name, owner and the approver's own scopes to tick; then its bearer. */
export function A2aClientForm({ fleetId, requestId, owners, scopes, listed }: { fleetId: string; requestId: string; owners: OwnerChoices; scopes: readonly string[]; listed: readonly ListedScope[] }) {
  const fieldId = useId();
  const [state, action] = useActionState(addA2aClient, IDLE);
  if (state.kind === 'added') {
    return <Added name={state.name} bearer={state.bearer} fleetId={fleetId} />;
  }
  return (
    <form action={action} className={`${CARD} grid max-w-160 gap-3`} data-testid="add-a2a-client-form">
      <input type="hidden" name={FLEET_FIELD} value={fleetId} />
      <input type="hidden" name="requestId" value={requestId} />
      <h1 className="text-heading-touch font-semibold max-sm:sr-only">Add an A2A client</h1>
      <Label htmlFor={fieldId + '-0'} className={LABEL}>
        <span>Name, the proxy ship&apos;s</span>
        <Input id={fieldId + '-0'} className={INPUT} name="name" required />
      </Label>
      <OwnerField choices={owners.isOk ? owners.value : []} current={null} help="A person ship or argo. It answers for this client." refusal={owners.isOk ? undefined : owners.refusal} />
      {scopes.length === 0 ? null : (
        <fieldset className="grid gap-2">
          <legend className="font-medium">Scopes, beside sending and receiving</legend>
          {scopes.map((scope) => (
            <Label htmlFor={fieldId + '-1' + "-" + (scope)} key={scope} className="flex items-center gap-2">
              <FormCheckbox id={fieldId + '-1' + "-" + (scope)} name={`${SCOPE_FIELD_PREFIX}${scope}`} />
              <span className="grid gap-0.5"><span className="font-mono text-code">{scope}</span><span className="text-caption text-muted-foreground">{listed.find((item) => item.scope === scope)?.description ?? STATIC_DESCRIPTIONS.get(scope)}</span></span>
            </Label>
          ))}
        </fieldset>
      )}
      <div>
        <SubmitButton pending="Adding…">Add</SubmitButton>
      </div>
      <Outcome state={state.kind === 'refused' ? state : { kind: 'idle' }} />
    </form>
  );
}
